const { app, BrowserWindow, Menu, ipcMain, dialog, shell: desktop } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const pty = require('@lydell/node-pty');
const { autoUpdater } = require('electron-updater');
const { isInstalled, install, uninstall } = require('./hooks-install');
const { subagentFile, entriesOf } = require('./transcript');
const worktree = require('./worktree');

const hooksFile = path.join(__dirname, 'claude-hooks.json');
// Claude Code hook event -> what the renderer calls it.
const EVENTS = { SessionStart: 'start', UserPromptSubmit: 'working', Notification: 'notify', Stop: 'stop', SessionEnd: 'end', SubagentStart: 'sub-start', SubagentStop: 'sub-stop', PermissionRequest: 'ask', PostToolUse: 'tool' };
// The longest question shown with a Yes button. A longer one is cut, and then only the terminal itself can answer it.
const ASK_MAX = 2000;
const ptys = new Map();
// Terminal id -> the folder its Claude Code session reported. The worktree commands run git
// there, so the renderer only ever names a terminal, never a path.
const cwds = new Map();
// "<terminal id>/<agent id>" -> that subagent's transcript file. The renderer only ever names
// a subagent by these two ids; the path is worked out and checked here.
const subFiles = new Map();
const READ_CHUNK = 4 * 1024 * 1024;
let win;
let nextId = 1;
let updating = false;
const mac = process.platform === 'darwin';

const send = (...args) => { if (win && !win.isDestroyed()) win.webContents.send(...args); };

// The hooks POST Claude Code's own hook JSON to http://127.0.0.1:<port>/<token>/<terminal id>.
// The token keeps other local programs and web pages from faking events.
const token = crypto.randomUUID();
const hookServer = http.createServer((req, res) => {
  const [, tok, id] = req.url.split('/');
  let body = '';
  req.on('data', (chunk) => { body += chunk; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    res.end();
    if (tok !== token) return;
    try {
      const d = JSON.parse(body);
      const event = EVENTS[d.hook_event_name];
      if (!event || !ptys.has(Number(id))) return;
      let agent;
      if (event === 'sub-start') {
        const file = subagentFile(path.join(claudeDir(), 'projects'), d.transcript_path, d.agent_id);
        if (!file) return;
        subFiles.set(`${Number(id)}/${d.agent_id}`, file);
      }
      if (event.startsWith('sub-')) {
        if (!subFiles.has(`${Number(id)}/${d.agent_id}`)) return;
        agent = { id: d.agent_id, type: String(d.agent_type || 'agent').slice(0, 60) };
      }
      if (typeof d.cwd === 'string' && path.isAbsolute(d.cwd) && fs.existsSync(d.cwd)) cwds.set(Number(id), d.cwd);
      // What the tool was asked to do: shown as text and compared, never run or opened.
      const input = d.tool_input && typeof d.tool_input === 'object' ? d.tool_input : {};
      const text = (v) => (typeof v === 'string' ? v : undefined);
      const detail = text(input.command) ?? text(input.file_path) ?? text(input.notebook_path) ?? text(input.url) ?? '';
      send('hook', Number(id), event, {
        session: d.session_id, kind: d.notification_type, cwd: d.cwd, agent,
        tool: text(d.tool_name)?.slice(0, 80),
        file: (text(input.file_path) ?? text(input.notebook_path))?.slice(0, 1000),
        detail: detail.slice(0, ASK_MAX),
        cut: detail.length > ASK_MAX,
      });
    } catch {}
  });
}).listen(0, '127.0.0.1');

// --- Klyngex's own settings: which shell and which agent command to start ---
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  shell: process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh',
  // An app started from the Finder gets a bare PATH; a login shell reads the profile that adds node and claude.
  shellArgs: mac ? ['-l'] : [],
  agent: 'claude',
};
function readSettings() {
  // shortcut: a settings file that is not valid JSON is silently ignored; report it once people edit it by hand a lot.
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { return DEFAULTS; }
}

// --- The user's Claude Code settings, only touched when they switch tracking of typed `claude` on or off ---
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const claudeSettingsFile = () => path.join(claudeDir(), 'settings.json');
function readClaudeSettings() {
  const f = claudeSettingsFile();
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')) : {};
}

function showWindow() {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// The "klyngex" / "kx" command passes the folder it was typed in as --cwd=<folder>.
function dirFrom(argv) {
  const arg = argv.find((a) => a.startsWith('--cwd='));
  const dir = arg && path.resolve(arg.slice(6));
  return dir && fs.existsSync(dir) ? dir : null;
}
let launchDir = dirFrom(process.argv);

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  showWindow();
  const dir = dirFrom(argv);
  if (dir) send('open-dir', dir);
});

app.whenReady().then(() => {
  // Windows only shows notifications for an app with an id.
  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'com.klyngex.app' : process.execPath);
  // The default menu steals Ctrl+W and Ctrl+R, which shells and agents need.
  // On a Mac the menu is what makes Cmd+C, Cmd+V and Cmd+Q work, and it only uses Cmd.
  Menu.setApplicationMenu(mac ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  win = new BrowserWindow({
    width: 1300,
    height: 800,
    backgroundColor: '#111111',
    icon: path.join(__dirname, 'terminal-agent-app-icons', process.platform === 'win32' ? 'app-icon.ico' : 'icon_512x512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile('index.html');
  watchForUpdates();
  win.on('focus', () => win.flashFrame(false));
  win.on('close', (e) => {
    if (!ptys.size || updating) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Close and kill them', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `${ptys.size} terminal(s) are still running.`,
      detail: 'Claude Code agents are reopened where they left off next time.',
    });
    if (choice === 1) e.preventDefault();
  });
});

// Updates come from the GitHub releases. A new version is downloaded in the background and
// the user is asked once it is ready; "Later" installs it the next time Klyngex is closed.
function watchForUpdates() {
  // shortcut: no update check on a Mac, macOS only installs updates for signed apps; switch on once the build is signed.
  if (!app.isPackaged || mac) return;
  autoUpdater.on('error', () => {}); // offline or no release yet: try again next time
  autoUpdater.on('update-downloaded', (info) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 1,
      cancelId: 1,
      message: `Klyngex ${info.version} is ready to install.`,
      detail: 'Restarting stops the running terminals; Claude Code agents are reopened where they left off. "Later" installs the update when you close Klyngex.',
    });
    if (choice === 0) {
      updating = true;
      autoUpdater.quitAndInstall();
    }
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 6 * 60 * 60 * 1000);
}

app.on('window-all-closed', () => {
  for (const p of ptys.values()) p.kill();
  app.quit();
});

// agent: undefined (plain shell), 'agent' (start the agent) or 'worktree' (in a new git worktree).
// resume: a Claude Code session id to reopen.
ipcMain.handle('pty:create', (_e, { cwd, cols, rows, agent, resume }) => {
  const id = nextId++;
  if (!cwd || !fs.existsSync(cwd)) cwd = os.homedir();
  const s = readSettings();
  const powershell = /^(powershell|pwsh)(\.exe)?$/i.test(path.basename(String(s.shell)));

  let command = '';
  if (agent) {
    command = String(s.agent);
    // The flags below are Claude Code's; any other agent is started as written and tracked by its output.
    if (/^claude(\.exe)?$/i.test(path.basename(command.trim().split(/\s+/)[0]))) {
      command += powershell ? ` --settings '${hooksFile.replace(/'/g, "''")}'` : ` --settings "${hooksFile}"`;
      if (agent === 'worktree') command += ' --worktree';
      if (/^[\w-]+$/.test(resume || '')) command += ` --resume ${resume}`;
    }
  }

  const args = Array.isArray(s.shellArgs) ? s.shellArgs.map(String) : [];
  if (powershell) {
    // Wrap whatever prompt the profile set up so it also reports the current folder (OSC 9;9,
    // the Windows Terminal convention). The renderer reads it to follow `cd`. The agent is
    // started by the shell, which stays open afterwards, so you land in it when the agent exits.
    const reportCwd = "$global:__kx = $function:prompt; function global:prompt { $l = $executionContext.SessionState.Path.CurrentLocation; if ($l.Provider.Name -eq 'FileSystem') { [Console]::Write(([string][char]27) + ']9;9;' + $l.ProviderPath + ([string][char]7)) }; & $global:__kx }";
    args.push('-NoExit', '-Command', command ? `${reportCwd}; ${command}` : reportCwd);
  }

  // Started from the Finder there is no locale, and shells then garble anything that is not ASCII.
  const locale = process.platform === 'win32' || process.env.LANG ? {} : { LANG: 'en_US.UTF-8' };
  const env = { ...process.env, ...locale, KLYNGEX_HOOK: `http://127.0.0.1:${hookServer.address().port}/${token}/${id}` };
  const p = pty.spawn(String(s.shell), args, { name: 'xterm-256color', cwd, cols, rows, env });
  ptys.set(id, p);
  p.onData((data) => send('pty:data', id, data));
  p.onExit(() => {
    ptys.delete(id);
    cwds.delete(id);
    for (const key of subFiles.keys()) if (key.startsWith(`${id}/`)) subFiles.delete(key);
    send('pty:exit', id);
  });
  if (command && !powershell) {
    // shortcut: other shells get the command typed in once they have printed something; no
    // prompt hook is injected, so folders follow `cd` only if the shell already emits OSC 7.
    const first = p.onData(() => { first.dispose(); setTimeout(() => p.write(command + '\r'), 300); });
  }
  return { id, cwd };
});
ipcMain.on('pty:write', (_e, id, data) => ptys.get(id)?.write(data));
ipcMain.on('pty:resize', (_e, id, cols, rows) => ptys.get(id)?.resize(cols, rows));
ipcMain.on('pty:kill', (_e, id) => ptys.get(id)?.kill());
// What a subagent has written to its transcript since byte `from`. The view polls this.
// title: the short description Claude Code gave the subagent, sent with the first read.
ipcMain.handle('sub:read', (_e, id, agent, from) => {
  const file = subFiles.get(`${id}/${agent}`);
  const out = { entries: [], next: from };
  if (!file || !Number.isSafeInteger(from) || from < 0) return out;
  try {
    const fd = fs.openSync(file, 'r');
    let buf;
    try {
      buf = Buffer.alloc(Math.min(Math.max(fs.fstatSync(fd).size - from, 0), READ_CHUNK));
      fs.readSync(fd, buf, 0, buf.length, from);
    } finally {
      fs.closeSync(fd);
    }
    // Only whole lines; a half-written one is picked up next time. A single line longer
    // than the chunk is skipped (its tail then fails to parse and is dropped).
    const end = buf.lastIndexOf(10) + 1 || (buf.length === READ_CHUNK ? READ_CHUNK : 0);
    out.entries = entriesOf(buf.toString('utf8', 0, end));
    out.next = from + end;
    if (from === 0) out.title = String(JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')).description || '').slice(0, 80);
  } catch {} // not written yet, or no description: the next poll tries again
  return out;
});
// --- Worktree agents: what the agent changed on its branch, and merging or deleting it (worktree.js) ---
ipcMain.handle('wt:info', (_e, id) => worktree.info(cwds.get(id)));
ipcMain.handle('wt:diff', (_e, id) => worktree.diff(cwds.get(id)));
ipcMain.handle('wt:merge', (_e, id) => worktree.merge(cwds.get(id)));
// The renderer asks first and closes the terminal after. A shell still standing in the folder keeps Windows from deleting it.
ipcMain.handle('wt:remove', (_e, id) => worktree.remove(cwds.get(id), () => {
  const p = ptys.get(id);
  return p && new Promise((resolve) => { p.onExit(resolve); p.kill(); });
}));

ipcMain.on('flash',(_e, on) => win.flashFrame(on && !win.isFocused()));
ipcMain.on('show-window', showWindow);
ipcMain.handle('version', () => app.getVersion());
ipcMain.handle('launch-dir', () => { const dir = launchDir; launchDir = null; return dir; });
ipcMain.handle('pick-folder', async (_e, startAt) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: startAt });
  return r.filePaths[0];
});

// Terminal output is untrusted: only ever hand web links to the system.
ipcMain.on('open-link', (_e, url) => { if (/^https?:\/\//i.test(String(url))) desktop.openExternal(url); });

// Shells found on this machine, offered as suggestions on the settings page.
function findShells() {
  if (process.platform !== 'win32') {
    return [...new Set([process.env.SHELL, '/bin/zsh', '/bin/bash'].filter((s) => s && fs.existsSync(s)))];
  }
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const found = ['powershell.exe', 'pwsh.exe', 'cmd.exe', 'wsl.exe'].filter((exe) => dirs.some((d) => fs.existsSync(path.join(d, exe))));
  const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  if (fs.existsSync(gitBash)) found.push(gitBash);
  return found;
}

ipcMain.handle('settings:get', () => ({ ...readSettings(), shells: findShells() }));
ipcMain.handle('settings:set', (_e, s) => {
  const next = {
    shell: String(s.shell || '').trim() || DEFAULTS.shell,
    shellArgs: Array.isArray(s.shellArgs) ? s.shellArgs.map(String) : [],
    agent: String(s.agent || '').trim() || DEFAULTS.agent,
  };
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2) + '\n');
});

ipcMain.handle('hooks:state', () => {
  try { return { on: isInstalled(readClaudeSettings()), file: claudeSettingsFile() }; } catch { return { on: false, file: claudeSettingsFile() }; }
});
ipcMain.handle('hooks:set', (_e, on) => {
  const f = claudeSettingsFile();
  let current;
  try {
    current = readClaudeSettings();
  } catch {
    dialog.showErrorBox('Klyngex', `${f} is not valid JSON, so it was left untouched.`);
    return false;
  }
  if (fs.existsSync(f)) fs.copyFileSync(f, f + '.klyngex-backup');
  const next = on ? install(current, JSON.parse(fs.readFileSync(hooksFile, 'utf8')).hooks) : uninstall(current);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(next, null, 2) + '\n');
  return on;
});

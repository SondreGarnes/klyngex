const { app, BrowserWindow, Menu, ipcMain, dialog, shell: desktop } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const pty = require('@lydell/node-pty');
const { isInstalled, install, uninstall } = require('./hooks-install');

const hooksFile = path.join(__dirname, 'claude-hooks.json');
// Claude Code hook event -> what the renderer calls it.
const EVENTS = { SessionStart: 'start', UserPromptSubmit: 'working', Notification: 'notify', Stop: 'stop', SessionEnd: 'end' };
const ptys = new Map();
let win;
let nextId = 1;

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
      if (event) send('hook', Number(id), event, { session: d.session_id, kind: d.notification_type, cwd: d.cwd });
    } catch {}
  });
}).listen(0, '127.0.0.1');

// --- Klyngex's own settings: which shell and which agent command to start ---
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  shell: process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash',
  shellArgs: [],
  agent: 'claude',
};
function readSettings() {
  // shortcut: a settings file that is not valid JSON is silently ignored; report it once people edit it by hand a lot.
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { return DEFAULTS; }
}

// --- The user's Claude Code settings, only touched when they switch tracking of typed `claude` on or off ---
const claudeSettingsFile = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
function readClaudeSettings() {
  const f = claudeSettingsFile();
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')) : {};
}

function showWindow() {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', showWindow);

app.whenReady().then(() => {
  // Windows only shows notifications for an app with an id.
  app.setAppUserModelId(app.isPackaged ? 'com.klyngex.app' : process.execPath);
  // The default menu steals Ctrl+W and Ctrl+R, which shells and agents need.
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1300,
    height: 800,
    backgroundColor: '#111111',
    icon: path.join(__dirname, 'terminal-agent-app-icons', process.platform === 'win32' ? 'app-icon.ico' : 'icon_512x512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile('index.html');
  win.on('focus', () => win.flashFrame(false));
  win.on('close', (e) => {
    if (!ptys.size) return;
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

  const env = { ...process.env, KLYNGEX_HOOK: `http://127.0.0.1:${hookServer.address().port}/${token}/${id}` };
  const p = pty.spawn(String(s.shell), args, { name: 'xterm-256color', cwd, cols, rows, env });
  ptys.set(id, p);
  p.onData((data) => send('pty:data', id, data));
  p.onExit(() => { ptys.delete(id); send('pty:exit', id); });
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
ipcMain.on('flash', (_e, on) => win.flashFrame(on && !win.isFocused()));
ipcMain.on('show-window', showWindow);
ipcMain.handle('pick-folder', async (_e, startAt) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: startAt });
  return r.filePaths[0];
});

// Terminal output is untrusted: only ever hand web links to the system.
ipcMain.on('open-link', (_e, url) => { if (/^https?:\/\//i.test(String(url))) desktop.openExternal(url); });

ipcMain.on('open-settings', () => {
  if (!fs.existsSync(settingsFile())) fs.writeFileSync(settingsFile(), JSON.stringify(DEFAULTS, null, 2) + '\n');
  desktop.openPath(settingsFile());
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

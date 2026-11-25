const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const pty = require('@lydell/node-pty');

const HOOK_EVENTS = ['start', 'working', 'notify', 'stop', 'end'];
const ptys = new Map();
let win;
let nextId = 1;

const send = (...args) => { if (win && !win.isDestroyed()) win.webContents.send(...args); };

// Claude Code hooks (claude-hooks.json) call http://127.0.0.1:<port>/<token>/<terminal id>/<event>.
// The token keeps other local programs and web pages from faking events.
const token = crypto.randomUUID();
const hookServer = http.createServer((req, res) => {
  const [, tok, id, event] = req.url.split('/');
  if (tok === token && HOOK_EVENTS.includes(event)) send('hook', Number(id), event);
  res.end();
}).listen(0, '127.0.0.1');

function showWindow() {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', showWindow);

app.whenReady().then(() => {
  // Windows only shows notifications for an app with an id.
  app.setAppUserModelId(app.isPackaged ? 'com.local.klyngex' : process.execPath);
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
    });
    if (choice === 1) e.preventDefault();
  });
});

app.on('window-all-closed', () => {
  for (const p of ptys.values()) p.kill();
  app.quit();
});

// agent: undefined (plain shell), 'agent' (start claude) or 'worktree' (claude in a new git worktree).
ipcMain.handle('pty:create', (_e, { cwd, cols, rows, agent }) => {
  const id = nextId++;
  if (!cwd || !fs.existsSync(cwd)) cwd = os.homedir();
  const win32 = process.platform === 'win32';
  const shell = win32 ? 'powershell.exe' : process.env.SHELL || 'bash';
  const env = { ...process.env, KLYNGEX_HOOK: `http://127.0.0.1:${hookServer.address().port}/${token}/${id}` };
  let args = [];
  if (agent) {
    // Started by the shell, which stays open afterwards, so you land in it when claude exits.
    const file = path.join(__dirname, 'claude-hooks.json').replace(/'/g, win32 ? "''" : "'\\''");
    const claude = `claude --settings '${file}'${agent === 'worktree' ? ' --worktree' : ''}`;
    args = win32 ? ['-NoExit', '-Command', claude] : ['-i', '-c', `${claude}; exec "${shell}" -i`];
  }
  const p = pty.spawn(shell, args, { name: 'xterm-256color', cwd, cols, rows, env });
  ptys.set(id, p);
  p.onData((data) => send('pty:data', id, data));
  p.onExit(() => { ptys.delete(id); send('pty:exit', id); });
  return { id, cwd };
});
ipcMain.on('pty:write', (_e, id, data) => ptys.get(id)?.write(data));
ipcMain.on('pty:resize', (_e, id, cols, rows) => ptys.get(id)?.resize(cols, rows));
ipcMain.on('pty:kill', (_e, id) => ptys.get(id)?.kill());
ipcMain.on('flash', (_e, on) => win.flashFrame(on && !win.isFocused()));
ipcMain.on('show-window', showWindow);
ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.filePaths[0];
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  create: (opts) => ipcRenderer.invoke('pty:create', opts),
  write: (id, data) => ipcRenderer.send('pty:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  kill: (id) => ipcRenderer.send('pty:kill', id),
  flash: (on) => ipcRenderer.send('flash', on),
  showWindow: () => ipcRenderer.send('show-window'),
  pickFolder: (startAt) => ipcRenderer.invoke('pick-folder', startAt),
  openLink: (url) => ipcRenderer.send('open-link', url),
  openSettings: () => ipcRenderer.send('open-settings'),
  hooksState: () => ipcRenderer.invoke('hooks:state'),
  setHooks: (on) => ipcRenderer.invoke('hooks:set', on),
  launchDir: () => ipcRenderer.invoke('launch-dir'),
  onOpenDir: (cb) => ipcRenderer.on('open-dir', (_e, dir) => cb(dir)),
  onData: (cb) => ipcRenderer.on('pty:data', (_e, id, data) => cb(id, data)),
  onExit: (cb) => ipcRenderer.on('pty:exit', (_e, id) => cb(id)),
  onHook: (cb) => ipcRenderer.on('hook', (_e, id, event, info) => cb(id, event, info)),
});

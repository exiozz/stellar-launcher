const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orbitOverlay', {
  onCursor: (cb) => ipcRenderer.on('fx:cursor', (_e, p) => cb(p)),
  onOptions: (cb) => ipcRenderer.on('fx:options', (_e, o) => cb(o)),
  onReset: (cb) => ipcRenderer.on('fx:reset', () => cb()),
  onMusic: (cb) => ipcRenderer.on('music:popup', (_e, s) => cb(s)),
  musicCmd: (c) => ipcRenderer.invoke('music:cmd', c),
  closePlayer: () => ipcRenderer.invoke('music:player', 'hide'),
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexWhale', {
  getState: () => ipcRenderer.invoke('whale:get-state'),
  refreshUsage: () => ipcRenderer.invoke('whale:refresh-usage'),
  savePreferences: (preferences) => ipcRenderer.invoke('whale:save-preferences', preferences),
  setInteractive: (interactive) => ipcRenderer.send('whale:set-interactive', Boolean(interactive)),
  beginDrag: (point) => ipcRenderer.send('whale:drag-begin', point),
  moveDrag: (point) => ipcRenderer.send('whale:drag-move', point),
  endDrag: () => ipcRenderer.send('whale:drag-end'),
  quit: () => ipcRenderer.send('whale:quit'),
  onUsage: (listener) => ipcRenderer.on('whale:usage', (_event, value) => listener(value)),
  onCodexEvent: (listener) => ipcRenderer.on('whale:codex-event', (_event, value) => listener(value)),
  onSide: (listener) => ipcRenderer.on('whale:side', (_event, value) => listener(value))
});

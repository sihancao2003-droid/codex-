const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexWhale', {
  getState: () => ipcRenderer.invoke('whale:get-state'),
  refreshUsage: () => ipcRenderer.invoke('whale:refresh-usage'),
  savePreferences: (preferences) => ipcRenderer.invoke('whale:save-preferences', preferences),
  switchAgent: (agentId) => ipcRenderer.invoke('whale:switch-agent', agentId),
  setInteractive: (interactive) => ipcRenderer.send('whale:set-interactive', Boolean(interactive)),
  setFocusable: (focusable) => ipcRenderer.send('whale:set-focusable', Boolean(focusable)),
  beginDrag: (point) => ipcRenderer.send('whale:drag-begin', point),
  moveDrag: (point) => ipcRenderer.send('whale:drag-move', point),
  endDrag: () => ipcRenderer.send('whale:drag-end'),
  quit: () => ipcRenderer.send('whale:quit'),
  onUsage: (listener) => ipcRenderer.on('whale:usage', (_event, value) => listener(value)),
  onCodexEvent: (listener) => ipcRenderer.on('whale:codex-event', (_event, value) => listener(value)),
  onAgents: (listener) => ipcRenderer.on('whale:agents', (_event, value) => listener(value)),
  onAgentChanged: (listener) => ipcRenderer.on('whale:agent-changed', (_event, value) => listener(value)),
  onSide: (listener) => ipcRenderer.on('whale:side', (_event, value) => listener(value))
});

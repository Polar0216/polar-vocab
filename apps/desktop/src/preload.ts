import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge } from './contracts'

const bridge: DesktopBridge = {
  status: () => ipcRenderer.invoke('capture:status'),
  settings: (value) => ipcRenderer.invoke('capture:settings', value),
  lookup: (value) => ipcRenderer.invoke('capture:lookup', value),
  cancelLookup: (id) => ipcRenderer.invoke('capture:cancel-lookup', id),
  save: (value) => ipcRenderer.invoke('capture:save', value),
  queue: (value) => ipcRenderer.invoke('capture:queue', value),
  connect: (value) => ipcRenderer.invoke('capture:connect', value),
  confirmConnection: () => ipcRenderer.invoke('capture:confirm-connection'),
  cancelConnection: () => ipcRenderer.invoke('capture:cancel-connection'),
  disconnect: () => ipcRenderer.invoke('capture:disconnect'),
  sync: () => ipcRenderer.invoke('capture:sync'),
  retry: () => ipcRenderer.invoke('capture:retry'),
  exportQueue: () => ipcRenderer.invoke('capture:export'),
  openWebsite: () => ipcRenderer.invoke('capture:website'),
  hide: () => ipcRenderer.invoke('capture:hide'),
  quit: () => ipcRenderer.invoke('capture:quit'),
  onSelection: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, selection: Parameters<typeof callback>[0]) => callback(selection)
    ipcRenderer.on('capture:selection', handler)
    return () => ipcRenderer.removeListener('capture:selection', handler)
  },
}
contextBridge.exposeInMainWorld('polarCapture', Object.freeze(bridge))

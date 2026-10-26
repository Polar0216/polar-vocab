import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge } from './contracts'

const bridge: DesktopBridge = {
  status: () => ipcRenderer.invoke('capture:status'),
  settings: (value) => ipcRenderer.invoke('capture:settings', value),
  lookup: (value) => ipcRenderer.invoke('capture:lookup', value),
  translate: value => ipcRenderer.invoke('capture:translate', value),
  translateSentence: value => ipcRenderer.invoke('capture:sentence', value),
  cancelLookup: (id) => ipcRenderer.invoke('capture:cancel-lookup', id),
  save: (value) => ipcRenderer.invoke('capture:save', value),
  queue: (value) => ipcRenderer.invoke('capture:queue', value),
  connect: (value) => ipcRenderer.invoke('capture:connect', value),
  confirmConnection: options => ipcRenderer.invoke('capture:confirm-connection', options),
  cancelConnection: () => ipcRenderer.invoke('capture:cancel-connection'),
  disconnect: () => ipcRenderer.invoke('capture:disconnect'),
  restoreAuthorization: () => ipcRenderer.invoke('capture:restore-authorization'),
  verifyWebsite: () => ipcRenderer.invoke('capture:verify-website'),
  importOldQueue: () => ipcRenderer.invoke('capture:import-old-queue'),
  sync: () => ipcRenderer.invoke('capture:sync'),
  retry: () => ipcRenderer.invoke('capture:retry'),
  exportQueue: () => ipcRenderer.invoke('capture:export'),
  openWebsite: () => ipcRenderer.invoke('capture:website'),
  hide: () => ipcRenderer.invoke('capture:hide'),
  quit: () => ipcRenderer.invoke('capture:quit'),
  selectionPainted: id => ipcRenderer.send('capture:selection-painted', id),
  onSentence: callback => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]) => callback(progress)
    ipcRenderer.on('capture:sentence-progress', handler)
    return () => ipcRenderer.removeListener('capture:sentence-progress', handler)
  },
  onNavigate: callback => {
    const handler = (_event: Electron.IpcRendererEvent, tab: Parameters<typeof callback>[0]) => callback(tab)
    ipcRenderer.on('capture:navigate', handler)
    return () => ipcRenderer.removeListener('capture:navigate', handler)
  },
  onCaptureProgress: callback => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]) => callback(progress)
    ipcRenderer.on('capture:progress', handler)
    return () => ipcRenderer.removeListener('capture:progress', handler)
  },
  onLookup: callback => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]) => callback(progress)
    ipcRenderer.on('capture:lookup-progress', handler)
    return () => ipcRenderer.removeListener('capture:lookup-progress', handler)
  },
  onSelection: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, selection: Parameters<typeof callback>[0]) => callback(selection)
    ipcRenderer.on('capture:selection', handler)
    return () => ipcRenderer.removeListener('capture:selection', handler)
  },
}
contextBridge.exposeInMainWorld('polarCapture', Object.freeze(bridge))

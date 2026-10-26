import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('captureFeedback', Object.freeze({
  onProgress: (callback: (progress: { id: string; repeated: boolean }) => void) => {
    ipcRenderer.on('capture:feedback', (_event, progress: { id: string; repeated: boolean }) => callback(progress))
  },
  painted: (id: string) => ipcRenderer.send('capture:feedback-painted', id),
}))

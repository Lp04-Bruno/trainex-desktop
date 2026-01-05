import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  openIcsFile: () => ipcRenderer.invoke('open-ics-file'),
  getVersions: () => process.versions
})

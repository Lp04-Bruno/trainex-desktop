import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  openIcsFile: () => ipcRenderer.invoke('open-ics-file'),
  loadLastIcs: () => ipcRenderer.invoke('load-last-ics'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  getVersions: () => process.versions
})

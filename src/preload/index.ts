import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  openIcsFile: () => ipcRenderer.invoke('open-ics-file'),
  loadLastIcs: () => ipcRenderer.invoke('load-last-ics'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  exportJson: (suggestedName: string, jsonText: string) =>
    ipcRenderer.invoke('export-text-file', {
      suggestedName,
      filters: [{ name: 'JSON', extensions: ['json'] }],
      content: jsonText
    }),
  exportCsv: (suggestedName: string, csvText: string) =>
    ipcRenderer.invoke('export-text-file', {
      suggestedName,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      content: csvText
    }),
  getVersions: () => process.versions
})

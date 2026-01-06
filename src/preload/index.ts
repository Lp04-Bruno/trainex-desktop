import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  openIcsFile: () => ipcRenderer.invoke('open-ics-file'),
  loadLastIcs: () => ipcRenderer.invoke('load-last-ics'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  onSyncStatus: (callback: (text: string) => void): (() => void) => {
    const handler = (_evt: Electron.IpcRendererEvent, payload: { text: string }): void => {
      callback(payload.text)
    }
    ipcRenderer.on('sync-status', handler)
    return () => ipcRenderer.removeListener('sync-status', handler)
  },
  onSyncResult: (
    callback: (
      payload:
        | { ok: true; source: 'manual' | 'saved' | 'auto'; icsText: string }
        | { ok: false; source: 'manual' | 'saved' | 'auto'; error: string; hint?: string }
    ) => void
  ): (() => void) => {
    const handler = (
      _evt: Electron.IpcRendererEvent,
      payload:
        | { ok: true; source: 'manual' | 'saved' | 'auto'; icsText: string }
        | { ok: false; source: 'manual' | 'saved' | 'auto'; error: string; hint?: string }
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('sync-result', handler)
    return () => ipcRenderer.removeListener('sync-result', handler)
  },
  syncTrainexIcs: (args: {
    username: string
    password: string
    day: number
    month: number
    year: number
  }) => ipcRenderer.invoke('sync-trainex-ics', args),
  syncTrainexIcsSaved: (args: { day: number; month: number; year: number }) =>
    ipcRenderer.invoke('sync-trainex-ics-saved', args),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (args: {
    username: string
    savePassword: boolean
    password?: string
    autoRefreshEnabled: boolean
  }) => ipcRenderer.invoke('settings:set', args),
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

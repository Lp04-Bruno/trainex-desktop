export {}

declare global {
  interface Window {
    api: {
      openIcsFile: () => Promise<string | null>
      loadLastIcs: () => Promise<string | null>
      clearCache: () => Promise<boolean>
      onSyncStatus: (callback: (text: string) => void) => () => void
      onSyncResult: (
        callback: (
          payload:
            | { ok: true; source: 'manual' | 'saved' | 'auto'; icsText: string }
            | { ok: false; source: 'manual' | 'saved' | 'auto'; error: string; hint?: string }
        ) => void
      ) => () => void
      syncTrainexIcs: (args: {
        username: string
        password: string
        day: number
        month: number
        year: number
      }) => Promise<{ ok: true; icsText: string } | { ok: false; error: string; hint?: string }>
      syncTrainexIcsSaved: (args: {
        day: number
        month: number
        year: number
      }) => Promise<{ ok: true; icsText: string } | { ok: false; error: string; hint?: string }>

      getSettings: () => Promise<{
        username: string
        hasSavedPassword: boolean
        autoRefreshEnabled: boolean
        canEncrypt: boolean
      }>
      setSettings: (args: {
        username: string
        savePassword: boolean
        password?: string
        autoRefreshEnabled: boolean
      }) => Promise<
        | {
            ok: true
            settings: {
              username: string
              hasSavedPassword: boolean
              autoRefreshEnabled: boolean
              canEncrypt: boolean
            }
          }
        | { ok: false; error: string }
      >
      exportJson: (
        suggestedName: string,
        jsonText: string
      ) => Promise<{ ok: true; path: string } | { ok: false; canceled: true }>
      exportCsv: (
        suggestedName: string,
        csvText: string
      ) => Promise<{ ok: true; path: string } | { ok: false; canceled: true }>
      getVersions: () => NodeJS.ProcessVersions
    }
  }
}

export {}

declare global {
  interface Window {
    api: {
      openIcsFile: () => Promise<string | null>
      loadLastIcs: () => Promise<string | null>
      clearCache: () => Promise<boolean>
      syncTrainexIcs: (args: {
        username: string
        password: string
        day: number
        month: number
        year: number
      }) => Promise<{ ok: true; icsText: string } | { ok: false; error: string; hint?: string }>
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

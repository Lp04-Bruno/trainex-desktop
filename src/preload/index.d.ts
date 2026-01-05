export {}

declare global {
  interface Window {
    api: {
      openIcsFile: () => Promise<string | null>
      loadLastIcs: () => Promise<string | null>
      clearCache: () => Promise<boolean>
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

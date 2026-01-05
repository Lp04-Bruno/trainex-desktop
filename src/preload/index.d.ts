export {}

declare global {
  interface Window {
    api: {
      openIcsFile: () => Promise<string | null>
      loadLastIcs: () => Promise<string | null>
      clearCache: () => Promise<boolean>
      getVersions: () => NodeJS.ProcessVersions
    }
  }
}

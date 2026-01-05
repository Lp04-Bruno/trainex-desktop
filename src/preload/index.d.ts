export {}

declare global {
  interface Window {
    api: {
      openIcsFile: () => Promise<string | null>
      getVersions: () => NodeJS.ProcessVersions
    }
  }
}

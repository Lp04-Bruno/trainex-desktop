import fs from 'fs'
import path from 'path'

export type SyncLogFn = (message: string, data?: Record<string, unknown>) => void

export function createSyncLogger(userDataDir: string): { log: SyncLogFn; logPath: string } {
  const logDir = path.join(userDataDir, 'logs')
  const logPath = path.join(logDir, 'trainex-sync.log')

  fs.mkdirSync(logDir, { recursive: true })

  const log: SyncLogFn = (message, data) => {
    const stamp = new Date().toISOString()
    const payload = data ? ` ${JSON.stringify(data)}` : ''
    fs.appendFileSync(logPath, `${stamp} ${message}${payload}\n`, 'utf-8')
  }

  return { log, logPath }
}

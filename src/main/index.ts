import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { createHash } from 'crypto'
import iconv from 'iconv-lite'
import { syncTrainexIcs } from './trainexSync'
import { createSyncLogger } from './syncLogger'
import {
  loadSettings,
  saveSettings,
  toPublicSettings,
  canUseEncryption,
  encryptAndStorePassword,
  decryptStoredPassword,
  clearSavedPassword,
  setAutoRefreshEnabled,
  setUsername,
  type AppSettings
} from './appSettings'

const chromiumCacheDir = join(app.getPath('userData'), 'chromium-cache')
fs.mkdirSync(chromiumCacheDir, { recursive: true })
app.commandLine.appendSwitch('disk-cache-dir', chromiumCacheDir)
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

function configurePlaywrightBrowsersPath(): void {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return

  if (app.isPackaged) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = join(process.resourcesPath, 'playwright-browsers')
    return
  }

  process.env.PLAYWRIGHT_BROWSERS_PATH = '0'
}

configurePlaywrightBrowsersPath()

let mainWindow: BrowserWindow | null = null

let settings: AppSettings = { version: 1, username: '', autoRefreshEnabled: false }
let autoRefreshTimer: NodeJS.Timeout | null = null
let autoRefreshRunning = false
let lastAutoRefreshAtMs = 0
let lastVerifiedCredentialsHash: string | null = null

function credentialsHash(username: string, password: string): string {
  return createHash('sha256').update(`${username}\n${password}`, 'utf-8').digest('hex')
}

function resolveWindowIconPath(): string | undefined {
  const candidates = [
    join(process.cwd(), 'resources', 'phwt_logo.png'),
    join(app.getAppPath(), 'resources', 'phwt_logo.png'),
    join(process.resourcesPath, 'phwt_logo.png')
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      /* ignore */
    }
  }
  return undefined
}

function berlinNowParts(date: Date): { year: number; month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  }).formatToParts(date)

  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type)?.value ?? '0'
    return Number(p)
  }

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour')
  }
}

function inBerlinAutoWindow(date: Date): boolean {
  const { hour } = berlinNowParts(date)
  return hour >= 6 && hour <= 20
}

function startOrStopAutoRefresh(): void {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer)
    autoRefreshTimer = null
  }

  if (!settings.autoRefreshEnabled) return
  if (!settings.encryptedPasswordBase64) return

  autoRefreshTimer = setInterval(
    () => {
      void runAutoRefreshTick()
    },
    5 * 60 * 1000
  )
  void runAutoRefreshTick()
}

async function runAutoRefreshTick(): Promise<void> {
  if (autoRefreshRunning) return
  if (!settings.autoRefreshEnabled) return
  if (!settings.encryptedPasswordBase64) return

  const now = new Date()
  if (!inBerlinAutoWindow(now)) return
  if (Date.now() - lastAutoRefreshAtMs < 2 * 60 * 60 * 1000) return

  const username = settings.username
  if (!username) return

  let password = ''
  try {
    password = decryptStoredPassword(settings.encryptedPasswordBase64)
  } catch {
    return
  }

  const { year, month, day } = berlinNowParts(now)
  autoRefreshRunning = true
  try {
    await runSyncWithCredentials(
      {
        username,
        password,
        year,
        month,
        day
      },
      'auto'
    )
    lastAutoRefreshAtMs = Date.now()
  } finally {
    autoRefreshRunning = false
  }
}

async function runSyncWithCredentials(
  args: { username: string; password: string; year: number; month: number; day: number },
  source: 'manual' | 'saved' | 'auto'
): Promise<{ ok: true; icsText: string } | { ok: false; error: string; hint?: string }> {
  const { log, logPath } = createSyncLogger(app.getPath('userData'))
  log('sync:start', { month: args.month, year: args.year, day: args.day, source })

  const sendStatus = (text: string): void => {
    mainWindow?.webContents.send('sync-status', { text })
  }

  const sendResult = (
    payload:
      | { ok: true; source: 'manual' | 'saved' | 'auto'; icsText: string }
      | { ok: false; source: 'manual' | 'saved' | 'auto'; error: string; hint?: string }
  ): void => {
    mainWindow?.webContents.send('sync-result', payload)
  }

  if (source === 'auto') {
    sendStatus('Stundenplan wird automatisch aktualisiert…')
  } else {
    sendStatus('Sync läuft…')
  }

  const profileDir = join(app.getPath('userData'), 'playwright', 'profile')
  const cacheDir = join(app.getPath('userData'), 'playwright', 'cache')
  fs.mkdirSync(profileDir, { recursive: true })
  fs.mkdirSync(cacheDir, { recursive: true })

  const res = await syncTrainexIcs({
    username: args.username,
    password: args.password,
    year: args.year,
    month: args.month,
    day: args.day,
    log,
    profileDir,
    cacheDir,
    status: sendStatus
  })

  if (!res.ok) {
    log('sync:fail', { error: res.error, hasHint: Boolean(res.hint) })
    const hint = res.hint ? `${res.hint} | Log: ${logPath}` : `Log: ${logPath}`
    sendStatus(`Sync fehlgeschlagen. Log: ${logPath}`)
    const out = { ...res, hint }
    sendResult({ ok: false, source, error: out.error, hint: out.hint })
    return out
  }

  const buffer = Buffer.from(res.icsBytesBase64, 'base64')
  const decoded = decodeIcsText(buffer)

  try {
    const debugIcsPath = join(app.getPath('userData'), 'logs', 'last-sync.ics')
    fs.mkdirSync(join(app.getPath('userData'), 'logs'), { recursive: true })
    fs.writeFileSync(debugIcsPath, decoded, 'utf-8')
    log('sync:wrote-debug-ics', { path: debugIcsPath, decodedChars: decoded.length })
  } catch {
    /* ignore */
  }

  writeLastIcsCache(decoded)
  log('sync:ok', { bytes: buffer.length, decodedChars: decoded.length })
  sendStatus(source === 'auto' ? 'Stundenplan automatisch aktualisiert.' : 'Sync abgeschlossen.')
  sendResult({ ok: true, source, icsText: decoded })

  if (source === 'manual') {
    lastVerifiedCredentialsHash = credentialsHash(args.username, args.password)
  }

  if (source !== 'auto' && settings.autoRefreshEnabled && settings.encryptedPasswordBase64) {
    lastAutoRefreshAtMs = Date.now()
  }

  return { ok: true as const, icsText: decoded }
}

function createWindow(): void {
  const iconPath = resolveWindowIconPath()
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  settings = loadSettings()
  startOrStopAutoRefresh()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('open-ics-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'iCal', extensions: ['ics'] }]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const filePath = result.filePaths[0]
  const buffer = fs.readFileSync(filePath)
  const content = decodeIcsText(buffer)
  writeLastIcsCache(content)
  return content
})

ipcMain.handle('load-last-ics', async () => {
  try {
    const p = getLastIcsCachePath()
    if (!fs.existsSync(p)) return null
    return fs.readFileSync(p, 'utf-8')
  } catch {
    return null
  }
})

ipcMain.handle('clear-cache', async () => {
  try {
    fs.rmSync(getLastIcsCachePath(), { force: true })
    return true
  } catch {
    return false
  }
})

ipcMain.handle(
  'export-text-file',
  async (
    _evt,
    args: { suggestedName: string; filters: Electron.FileFilter[]; content: string }
  ) => {
    const { suggestedName, filters, content } = args
    const result = await dialog.showSaveDialog({
      defaultPath: join(app.getPath('downloads'), suggestedName),
      filters
    })

    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true as const }
    }

    fs.writeFileSync(result.filePath, content, 'utf-8')
    return { ok: true as const, path: result.filePath }
  }
)

ipcMain.handle(
  'sync-trainex-ics',
  async (
    _evt,
    args: {
      username: string
      password: string
      month: number
      year: number
      day: number
    }
  ) => {
    return runSyncWithCredentials(args, 'manual')
  }
)

ipcMain.handle(
  'sync-trainex-ics-saved',
  async (_evt, args: { month: number; year: number; day: number }) => {
    if (!settings.username || !settings.encryptedPasswordBase64) {
      return { ok: false as const, error: 'Keine gespeicherten Login-Daten gefunden.' }
    }

    let password = ''
    try {
      password = decryptStoredPassword(settings.encryptedPasswordBase64)
    } catch {
      return {
        ok: false as const,
        error: 'Gespeichertes Passwort konnte nicht entschlüsselt werden.'
      }
    }

    return runSyncWithCredentials(
      {
        username: settings.username,
        password,
        month: args.month,
        year: args.year,
        day: args.day
      },
      'saved'
    )
  }
)

ipcMain.handle('settings:get', async () => {
  return toPublicSettings(settings)
})

ipcMain.handle(
  'settings:set',
  async (
    _evt,
    args: {
      username: string
      savePassword: boolean
      password?: string
      autoRefreshEnabled: boolean
    }
  ) => {
    const previous = settings
    let next = setUsername(previous, args.username)

    const usernameChanged = previous.username !== args.username
    if (usernameChanged) {
      next = clearSavedPassword(next)
      next = setAutoRefreshEnabled(next, false)
    }

    if (args.savePassword) {
      if (!canUseEncryption()) {
        return {
          ok: false as const,
          error: 'Verschlüsselung ist auf diesem System nicht verfügbar.'
        }
      }

      if (args.password) {
        const providedHash = credentialsHash(args.username, args.password)
        if (!lastVerifiedCredentialsHash || lastVerifiedCredentialsHash !== providedHash) {
          return {
            ok: false as const,
            error:
              'Bitte zuerst einmal erfolgreich synchronisieren, bevor du die Login-Daten speicherst.'
          }
        }

        next = {
          ...next,
          encryptedPasswordBase64: encryptAndStorePassword(args.password)
        }
      } else if (!next.encryptedPasswordBase64) {
        return { ok: false as const, error: 'Bitte ein Passwort eingeben, um es zu speichern.' }
      }

      next = setAutoRefreshEnabled(next, args.autoRefreshEnabled)
    } else {
      next = clearSavedPassword(next)
      next = setAutoRefreshEnabled(next, false)
    }

    settings = next
    saveSettings(settings)
    startOrStopAutoRefresh()
    return { ok: true as const, settings: toPublicSettings(settings) }
  }
)

function getCacheDir(): string {
  return join(app.getPath('userData'), 'cache')
}

function getLastIcsCachePath(): string {
  return join(getCacheDir(), 'latest.ics')
}

function writeLastIcsCache(icsText: string): void {
  const dir = getCacheDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getLastIcsCachePath(), icsText, 'utf-8')
}

function decodeIcsText(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return iconv.decode(buffer, 'utf16le')
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return iconv.decode(buffer, 'utf16be')
  }

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString('utf-8')
  }

  const asUtf8 = buffer.toString('utf-8')
  const utf8ReplacementCount = (asUtf8.match(/\uFFFD/g) ?? []).length
  if (utf8ReplacementCount > 0) {
    return iconv.decode(buffer, 'win1252')
  }

  const mojibakeCount = (asUtf8.match(/[ÃÂ]/g) ?? []).length
  if (mojibakeCount > 0) {
    const asWin1252 = iconv.decode(buffer, 'win1252')
    const winMojibakeCount = (asWin1252.match(/[ÃÂ]/g) ?? []).length
    return winMojibakeCount < mojibakeCount ? asWin1252 : asUtf8
  }

  return asUtf8
}

import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import fs from 'fs'
import iconv from 'iconv-lite'
import { syncTrainexIcs } from './trainexSync'
import { createSyncLogger } from './syncLogger'

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
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
    const { log, logPath } = createSyncLogger(app.getPath('userData'))
    log('sync:start', { month: args.month, year: args.year, day: args.day })

    const profileDir = join(app.getPath('userData'), 'playwright', 'profile')
    const cacheDir = join(app.getPath('userData'), 'playwright', 'cache')
    fs.mkdirSync(profileDir, { recursive: true })
    fs.mkdirSync(cacheDir, { recursive: true })

    const res = await syncTrainexIcs({ ...args, log, profileDir, cacheDir })
    if (!res.ok) {
      log('sync:fail', { error: res.error, hasHint: Boolean(res.hint) })
      const hint = res.hint ? `${res.hint} | Log: ${logPath}` : `Log: ${logPath}`
      return { ...res, hint }
    }

    const buffer = Buffer.from(res.icsBytesBase64, 'base64')
    const decoded = decodeIcsText(buffer)
    writeLastIcsCache(decoded)
    log('sync:ok', { bytes: buffer.length, decodedChars: decoded.length })
    return { ok: true as const, icsText: decoded }
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

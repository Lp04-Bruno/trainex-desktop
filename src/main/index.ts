import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import fs from 'fs'
import iconv from 'iconv-lite'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  // electron-vite: dev server URL oder gebaute index.html
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

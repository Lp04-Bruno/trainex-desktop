import { app, safeStorage } from 'electron'
import { join } from 'path'
import fs from 'fs'

export type AppSettings = {
  version: 1
  username: string
  encryptedPasswordBase64?: string
  autoRefreshEnabled: boolean
}

export type AppSettingsPublic = {
  username: string
  hasSavedPassword: boolean
  autoRefreshEnabled: boolean
  canEncrypt: boolean
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function canUseEncryption(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function loadSettings(): AppSettings {
  try {
    const p = settingsPath()
    if (!fs.existsSync(p)) {
      return { version: 1, username: '', autoRefreshEnabled: false }
    }
    const raw = fs.readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>

    return {
      version: 1,
      username: typeof parsed.username === 'string' ? parsed.username : '',
      encryptedPasswordBase64:
        typeof parsed.encryptedPasswordBase64 === 'string'
          ? parsed.encryptedPasswordBase64
          : undefined,
      autoRefreshEnabled: Boolean(parsed.autoRefreshEnabled)
    }
  } catch {
    return { version: 1, username: '', autoRefreshEnabled: false }
  }
}

export function saveSettings(next: AppSettings): void {
  const p = settingsPath()
  fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf-8')
}

export function toPublicSettings(settings: AppSettings): AppSettingsPublic {
  return {
    username: settings.username,
    hasSavedPassword: Boolean(settings.encryptedPasswordBase64),
    autoRefreshEnabled: settings.autoRefreshEnabled,
    canEncrypt: canUseEncryption()
  }
}

export function setUsername(settings: AppSettings, username: string): AppSettings {
  return { ...settings, username }
}

export function setAutoRefreshEnabled(settings: AppSettings, enabled: boolean): AppSettings {
  return { ...settings, autoRefreshEnabled: enabled }
}

export function clearSavedPassword(settings: AppSettings): AppSettings {
  return { ...settings, encryptedPasswordBase64: undefined }
}

export function encryptAndStorePassword(password: string): string {
  const buf = safeStorage.encryptString(password)
  return buf.toString('base64')
}

export function decryptStoredPassword(base64: string): string {
  const buf = Buffer.from(base64, 'base64')
  return safeStorage.decryptString(buf)
}

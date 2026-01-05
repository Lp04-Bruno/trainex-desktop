import type { Browser, BrowserContext, Page } from 'playwright'
import fs from 'fs'
import type { SyncLogFn } from './syncLogger'

type TrainexSyncArgs = {
  username: string
  password: string
  month: number
  year: number
  day: number
  timeoutMs?: number
  log?: SyncLogFn
  profileDir?: string
  cacheDir?: string
}

type TrainexSyncResult =
  | { ok: true; icsBytesBase64: string }
  | { ok: false; error: string; hint?: string }

const BASE_URL = 'https://trex.phwt.de/phwt-trainex/'
const DEFAULT_TIMEOUT_MS = 45_000

function icsCandidateUrl(args: Pick<TrainexSyncArgs, 'day' | 'month' | 'year'>): string {
  const utag = args.day > 0 ? String(args.day) : ''
  return `${BASE_URL}cfm/einsatzplan/einsatzplan_listenansicht_iCal.cfm?ics=1&utag=${utag}&umonat=${args.month}&ujahr=${args.year}`
}

function einsatzplanIndexUrl(): string {
  return `${BASE_URL}cfm/einsatzplan/`
}

function isIcsBytes(body: Buffer): boolean {
  return /BEGIN:VCALENDAR/i.test(body.toString('ascii'))
}

function isUtf16Le(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe
}

function isUtf16Be(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff
}

function hasUtf16VCalendar(buffer: Buffer): boolean {
  if (buffer.length < 4) return false
  if (isUtf16Le(buffer)) {
    return /BEGIN:VCALENDAR/i.test(buffer.toString('utf16le'))
  }
  if (isUtf16Be(buffer)) {
    const swapped = Buffer.allocUnsafe(buffer.length - 2)
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1]
      swapped[i - 1] = buffer[i]
    }
    return /BEGIN:VCALENDAR/i.test(swapped.toString('utf16le'))
  }
  return false
}

function looksLikeIcs(body: Buffer, headers: Record<string, string>): boolean {
  if (isIcsBytes(body)) return true
  if (hasUtf16VCalendar(body)) return true

  const ct = (headers['content-type'] ?? '').toLowerCase()
  if (ct.includes('text/calendar')) return true

  const cd = (headers['content-disposition'] ?? '').toLowerCase()
  if (cd.includes('.ics')) return true

  return false
}

function safeTextPreview(buffer: Buffer, maxBytes: number): string {
  const slice = buffer.subarray(0, Math.min(maxBytes, buffer.length))
  const txt = slice.toString('utf8')

  let out = ''
  for (let i = 0; i < txt.length; i++) {
    const code = txt.charCodeAt(i)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      out += ' '
    } else {
      out += txt[i]
    }
  }
  return out
}

function normalizeUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  return new URL(url, BASE_URL).toString()
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function findIcsExportUrlFromHtml(html: string): string | null {
  const decoded = decodeHtmlEntities(html)
  const re =
    /(?:href\s*=\s*['"])([^'"\s>]*einsatzplan_listenansicht_iCal\.cfm\?[^'"\s>]*ics=1[^'"\s>]*)/i
  const m = decoded.match(re)
  if (!m?.[1]) return null
  return normalizeUrl(m[1])
}

async function fillLoginForm(page: Page, username: string, password: string): Promise<void> {
  const userLocator = page.locator(
    'input[placeholder="Login"], input[name*="login" i], input[name*="user" i], input[type="text"]'
  )
  const passLocator = page.locator('input[placeholder="Passwort"], input[type="password"]')

  await userLocator.first().fill(username)
  await passLocator.first().fill(password)

  const submit = page.locator(
    'button:has-text("Anmelden"), input[type="submit"], button[type="submit"]'
  )
  await submit.first().click()
}

async function stillOnLoginPage(page: Page): Promise<boolean> {
  const loginInputs = page.locator('input[placeholder="Login"], input[placeholder="Passwort"]')
  if ((await loginInputs.count()) > 0) return true

  const loginButton = page.locator('button:has-text("Anmelden")')
  return (await loginButton.count()) > 0
}

async function discoverIcsUrl(page: Page): Promise<string | null> {
  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((els) =>
      els
        .map((e) => (e instanceof HTMLAnchorElement ? e.getAttribute('href') : null))
        .filter((x): x is string => Boolean(x))
    )

  for (const href of hrefs) {
    if (!/einsatzplan_listenansicht_iCal\.cfm\?/i.test(href)) continue
    if (!/ics=1/i.test(href)) continue
    return normalizeUrl(decodeHtmlEntities(href))
  }
  return null
}

export async function syncTrainexIcs(args: TrainexSyncArgs): Promise<TrainexSyncResult> {
  const { username, password, month, year, day, log, profileDir, cacheDir } = args
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (!username || !password) {
    return { ok: false, error: 'Bitte Login und Passwort eingeben.' }
  }
  if (month < 1 || month > 12) {
    return { ok: false, error: 'Ungültiger Monat.' }
  }

  const { chromium } = await import('playwright')

  const executablePath = chromium.executablePath()
  if (!fs.existsSync(executablePath)) {
    log?.('sync:missing-browser', { executablePath })
    return {
      ok: false,
      error: 'Interner Browser fehlt (Playwright Chromium).'
    }
  }

  let browser: Browser | null = null
  let context: BrowserContext | null = null

  try {
    if (profileDir) {
      context = await chromium.launchPersistentContext(profileDir, {
        headless: true,
        args: cacheDir ? [`--disk-cache-dir=${cacheDir}`] : []
      })
    } else {
      browser = await chromium.launch({
        headless: true,
        args: cacheDir ? [`--disk-cache-dir=${cacheDir}`] : []
      })
      context = await browser.newContext()
    }

    const page = await context.newPage()

    page.setDefaultTimeout(timeoutMs)

    log?.('sync:navigate', { url: BASE_URL })
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await fillLoginForm(page, username, password)

    await page.waitForLoadState('networkidle').catch(() => {})
    if (await stillOnLoginPage(page)) {
      log?.('sync:login-failed')
      return { ok: false, error: 'Login fehlgeschlagen. Bitte Zugangsdaten prüfen.' }
    }

    log?.('sync:login-ok', { url: page.url() })

    const tryFetch = async (url: string): Promise<string | null> => {
      log?.('sync:fetch', { url })
      const resp = await page.request.get(url, {
        headers: {
          Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8'
        }
      })
      const status = resp.status()
      const finalUrl = resp.url()
      const headers = resp.headers()
      if (!resp.ok()) {
        log?.('sync:fetch-not-ok', { url, status, finalUrl })
        return null
      }

      const body = Buffer.from(await resp.body())

      const okIcs = looksLikeIcs(body, headers)
      if (!okIcs) {
        log?.('sync:fetch-not-ics', {
          url,
          status,
          finalUrl,
          bytes: body.length,
          contentType: headers['content-type'] ?? null,
          contentDisposition: headers['content-disposition'] ?? null,
          previewText: safeTextPreview(body, 240),
          previewBase64: body.subarray(0, 96).toString('base64')
        })
        return null
      }

      log?.('sync:fetch-ok', {
        url,
        status,
        finalUrl,
        bytes: body.length,
        contentType: headers['content-type'] ?? null
      })
      return body.toString('base64')
    }

    const directMonth = await tryFetch(icsCandidateUrl({ day: 0, month, year }))
    if (directMonth) return { ok: true, icsBytesBase64: directMonth }

    const directDay = await tryFetch(icsCandidateUrl({ day, month, year }))
    if (directDay) return { ok: true, icsBytesBase64: directDay }

    const indexUrl = einsatzplanIndexUrl()
    log?.('sync:navigate', { url: indexUrl })
    await page.goto(indexUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})

    const html = await page.content()
    const discovered = findIcsExportUrlFromHtml(html)
    log?.('sync:discover-link', { found: Boolean(discovered) })
    if (discovered) {
      const fetched = await tryFetch(discovered)
      if (fetched) return { ok: true, icsBytesBase64: fetched }
    }

    const discoveredDom = await discoverIcsUrl(page)
    log?.('sync:discover-dom', { found: Boolean(discoveredDom) })
    if (discoveredDom) {
      const fetched = await tryFetch(discoveredDom)
      if (fetched) return { ok: true, icsBytesBase64: fetched }
    }

    return {
      ok: false,
      error: 'Sync fehlgeschlagen: iCal/ICS konnte nicht geladen werden.'
    }
  } catch (e) {
    return {
      ok: false,
      error: 'Sync fehlgeschlagen (unerwarteter Fehler).',
      hint: e instanceof Error ? e.message : String(e)
    }
  } finally {
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
  }
}

import type { BrowserContext, Page } from 'playwright'
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
  status?: (text: string) => void
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
  void headers
  if (isIcsBytes(body)) return true
  if (hasUtf16VCalendar(body)) return true
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

function findAnyIcalUrlFromHtml(html: string): string | null {
  const decoded = decodeHtmlEntities(html)
  const re = /einsatzplan_listenansicht_iCal\.cfm\?[^'"\s<>]*/gi
  const matches = decoded.match(re)
  if (!matches || matches.length === 0) return null

  const preferred = matches.find(
    (m) => /TokCF\d+=/i.test(m) || /IDphp\d+=/i.test(m) || /sec\d+=/i.test(m)
  )
  return normalizeUrl(preferred ?? matches[0])
}

function applyDateParams(
  url: string,
  args: Pick<TrainexSyncArgs, 'day' | 'month' | 'year'>
): string {
  const u = new URL(url)
  u.searchParams.set('ics', '1')
  u.searchParams.set('umonat', String(args.month))
  u.searchParams.set('ujahr', String(args.year))
  u.searchParams.set('utag', args.day > 0 ? String(args.day) : '')
  return u.toString()
}

function extractSessionTokenParams(url: string): Record<string, string> {
  const u = new URL(url)
  const out: Record<string, string> = {}
  for (const [k, v] of u.searchParams.entries()) {
    if (/^TokCF\d+$/i.test(k) || /^IDphp\d+$/i.test(k) || /^sec/i.test(k)) {
      out[k] = v
    }
  }
  return out
}

function buildTokenizedIcalUrl(
  tokens: Record<string, string>,
  args: Pick<TrainexSyncArgs, 'day' | 'month' | 'year'>
): string {
  const u = new URL(`${BASE_URL}cfm/einsatzplan/einsatzplan_listenansicht_iCal.cfm`)
  for (const [k, v] of Object.entries(tokens)) {
    u.searchParams.set(k, v)
  }
  u.searchParams.set('ics', '1')
  u.searchParams.set('umonat', String(args.month))
  u.searchParams.set('ujahr', String(args.year))
  u.searchParams.set('utag', args.day > 0 ? String(args.day) : '')
  return u.toString()
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
  const { username, password, month, year, day, log, status, profileDir, cacheDir } = args
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (!username || !password) {
    return { ok: false, error: 'Bitte Login und Passwort eingeben.' }
  }
  if (month < 1 || month > 12) {
    return { ok: false, error: 'Ungültiger Monat.' }
  }

  const { chromium } = await import('playwright')

  let context: BrowserContext | null = null

  const launchArgs = cacheDir ? [`--disk-cache-dir=${cacheDir}`] : []

  const tryLaunch = async (opts?: { channel?: string }): Promise<BrowserContext> => {
    if (profileDir) {
      return await chromium.launchPersistentContext(profileDir, {
        headless: true,
        args: launchArgs,
        ...(opts?.channel ? { channel: opts.channel } : {})
      })
    }

    const b = await chromium.launch({
      headless: true,
      args: launchArgs,
      ...(opts?.channel ? { channel: opts.channel } : {})
    })
    return await b.newContext()
  }

  try {
    const executablePath = chromium.executablePath()
    if (fs.existsSync(executablePath)) {
      context = await tryLaunch()
    } else if (process.platform === 'win32') {
      log?.('sync:missing-browser', { executablePath, fallback: 'msedge' })
      context = await tryLaunch({ channel: 'msedge' })
    } else {
      log?.('sync:missing-browser', { executablePath })
      return { ok: false, error: 'Interner Browser fehlt (Playwright Chromium).' }
    }

    const page = await context.newPage()

    page.setDefaultTimeout(timeoutMs)

    status?.('Login…')
    log?.('sync:navigate', { url: BASE_URL })
    const loginResp = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    log?.('sync:navigate-done', {
      requestedUrl: BASE_URL,
      finalUrl: page.url(),
      status: loginResp?.status() ?? null
    })
    await fillLoginForm(page, username, password)

    await page.waitForLoadState('networkidle').catch(() => {})
    if (await stillOnLoginPage(page)) {
      log?.('sync:login-failed')
      return { ok: false, error: 'Login fehlgeschlagen. Bitte Zugangsdaten prüfen.' }
    }

    log?.('sync:login-ok', { url: page.url() })
    status?.('Stundenplan laden…')

    const tryFetch = async (url: string): Promise<string | null> => {
      log?.('sync:fetch', { url })
      const referer = page.url()
      const resp = await page.request.get(url, {
        headers: {
          Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8',
          Referer: referer
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
          referer,
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

    const tokenBootstrapUrls = [
      `${BASE_URL}cfm/einsatzplan/einsatzplan_listenansicht_kt.cfm`,
      `${BASE_URL}cfm/einsatzplan/einsatzplan_stundenplan.cfm`,
      `${BASE_URL}cfm/einsatzplan/`
    ]

    for (const bootstrapUrl of tokenBootstrapUrls) {
      log?.('sync:navigate', { url: bootstrapUrl })
      const r = await page.goto(bootstrapUrl, { waitUntil: 'domcontentloaded' }).catch(() => null)
      await page.waitForLoadState('networkidle').catch(() => {})

      const finalUrl = page.url()
      log?.('sync:navigate-done', {
        requestedUrl: bootstrapUrl,
        finalUrl,
        status: r?.status() ?? null
      })

      const tokens = extractSessionTokenParams(finalUrl)
      const tokenCount = Object.keys(tokens).length
      log?.('sync:tokens-from-url', { count: tokenCount })

      if (tokenCount > 0) {
        status?.('Kalender laden…')
        const tokenizedMonth = buildTokenizedIcalUrl(tokens, { day: 0, month, year })
        const fetched = await tryFetch(tokenizedMonth)
        if (fetched) return { ok: true, icsBytesBase64: fetched }

        const tokenizedDay = buildTokenizedIcalUrl(tokens, { day, month, year })
        const fetchedDay = await tryFetch(tokenizedDay)
        if (fetchedDay) return { ok: true, icsBytesBase64: fetchedDay }
      }

      const html = await page.content().catch(() => '')
      const icalUrl = html ? findAnyIcalUrlFromHtml(html) : null
      log?.('sync:discover-ical-from-page', { found: Boolean(icalUrl) })
      if (icalUrl) {
        status?.('Kalender laden…')
        const resolved = applyDateParams(icalUrl, { day: 0, month, year })
        const fetched = await tryFetch(resolved)
        if (fetched) return { ok: true, icsBytesBase64: fetched }

        const resolvedDay = applyDateParams(icalUrl, { day, month, year })
        const fetchedDay = await tryFetch(resolvedDay)
        if (fetchedDay) return { ok: true, icsBytesBase64: fetchedDay }
      }
    }

    const directMonth = await tryFetch(icsCandidateUrl({ day: 0, month, year }))
    if (directMonth) return { ok: true, icsBytesBase64: directMonth }

    const directDay = await tryFetch(icsCandidateUrl({ day, month, year }))
    if (directDay) return { ok: true, icsBytesBase64: directDay }

    const indexUrl = einsatzplanIndexUrl()
    log?.('sync:navigate', { url: indexUrl })
    await page.goto(indexUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForLoadState('networkidle').catch(() => {})

    const htmlIndex = await page.content().catch(() => '')
    const discoveredAny = htmlIndex ? findAnyIcalUrlFromHtml(htmlIndex) : null
    log?.('sync:discover-ical-any-index', { found: Boolean(discoveredAny) })
    if (discoveredAny) {
      const resolved = applyDateParams(discoveredAny, { day: 0, month, year })
      const fetched = await tryFetch(resolved)
      if (fetched) return { ok: true, icsBytesBase64: fetched }

      const resolvedDay = applyDateParams(discoveredAny, { day, month, year })
      const fetchedDay = await tryFetch(resolvedDay)
      if (fetchedDay) return { ok: true, icsBytesBase64: fetchedDay }
    }

    const discovered2 = htmlIndex ? findIcsExportUrlFromHtml(htmlIndex) : null
    log?.('sync:discover-link-index', { found: Boolean(discovered2) })
    if (discovered2) {
      const fetched = await tryFetch(discovered2)
      if (fetched) return { ok: true, icsBytesBase64: fetched }
    }

    const discoveredDom2 = await discoverIcsUrl(page)
    log?.('sync:discover-dom-index', { found: Boolean(discoveredDom2) })
    if (discoveredDom2) {
      const fetched = await tryFetch(discoveredDom2)
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
    const b = context?.browser() ?? null
    await context?.close().catch(() => {})
    await b?.close().catch(() => {})
  }
}

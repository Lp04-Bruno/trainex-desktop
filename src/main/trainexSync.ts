import type { Page } from 'playwright'
import fs from 'fs'

type TrainexSyncArgs = {
  username: string
  password: string
  month: number
  year: number
  day: number
  timeoutMs?: number
}

type TrainexSyncResult =
  | { ok: true; icsBytesBase64: string }
  | { ok: false; error: string; hint?: string }

const BASE_URL = 'https://trex.phwt.de/phwt-trainex/'
const DEFAULT_TIMEOUT_MS = 45_000

function icsCandidateUrl(args: Pick<TrainexSyncArgs, 'day' | 'month' | 'year'>): string {
  return `${BASE_URL}cfm/einsatzplan/einsatzplan_listenansicht_iCal.cfm?ics=1&utag=${args.day}&umonat=${args.month}&ujahr=${args.year}`
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

function toBase64IcsOrNull(body: Buffer): string | null {
  if (!/BEGIN:VCALENDAR/i.test(body.toString('ascii'))) return null
  return body.toString('base64')
}

export async function syncTrainexIcs(args: TrainexSyncArgs): Promise<TrainexSyncResult> {
  const { username, password, month, year, day } = args
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
    return {
      ok: false,
      error: 'Interner Browser fehlt (Playwright Chromium).'
    }
  }

  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()

    page.setDefaultTimeout(timeoutMs)

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await fillLoginForm(page, username, password)

    await page.waitForLoadState('networkidle').catch(() => {})

    const tryFetch = async (url: string): Promise<string | null> => {
      const resp = await context.request.get(url)
      if (!resp.ok()) return null
      return toBase64IcsOrNull(Buffer.from(await resp.body()))
    }

    const direct = await tryFetch(icsCandidateUrl({ day, month, year }))
    if (direct) return { ok: true, icsBytesBase64: direct }

    const html = await page.content()
    const discovered = findIcsExportUrlFromHtml(html)
    if (discovered) {
      const fetched = await tryFetch(discovered)
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
    await browser.close().catch(() => {})
  }
}

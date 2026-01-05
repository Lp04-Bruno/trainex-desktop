export type TrainexEvent = {
  id: string
  summary: string
  start: string // ISO
  end: string // ISO
  location?: string
  description?: string
  categories?: string[]
}

/**
 * Minimal ICS parser for VEVENT blocks (TraiNex export).
 * Supports folded lines (RFC-style) and common fields.
 */
export function parseIcsToEvents(icsText: string): TrainexEvent[] {
  const unfolded = unfoldIcsLines(icsText)
  const lines = unfolded.split(/\r?\n/)

  const events: TrainexEvent[] = []
  let inEvent = false
  let current: Partial<TrainexEvent> & Record<string, unknown> = {}

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (line === 'BEGIN:VEVENT') {
      inEvent = true
      current = {}
      continue
    }
    if (line === 'END:VEVENT') {
      if (inEvent) {
        const summary = (current.summary ?? '').trim()
        const start = (current.start ?? '').trim()
        const end = (current.end ?? '').trim()

        if (summary && start && end) {
          const id = makeId(summary, start, end, current.location ?? '')
          events.push({
            id,
            summary,
            start,
            end,
            location: current.location,
            description: current.description,
            categories: current.categories
          })
        }
      }
      inEvent = false
      current = {}
      continue
    }

    if (!inEvent) continue

    const { key, value } = splitIcsLine(line)
    if (!key) continue

    switch (key) {
      case 'SUMMARY':
        current.summary = value
        break
      case 'DESCRIPTION':
        current.description = value
        break
      case 'LOCATION':
        current.location = value
        break
      case 'CATEGORIES':
        current.categories = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        break
      case 'DTSTART':
        current.start = icsDateToIso(value)
        break
      case 'DTEND':
        current.end = icsDateToIso(value)
        break
      default:
        // ignore
        break
    }
  }

  // sort by start
  events.sort((a, b) => a.start.localeCompare(b.start))
  return events
}

/** Unfold folded lines: lines beginning with space/tab are continuation */
function unfoldIcsLines(input: string): string {
  // Normalize newlines, then unfold
  const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return normalized.replace(/\n[ \t]/g, '')
}

/** Split "KEY;PARAM=...:VALUE" into { key, value } (we ignore params) */
function splitIcsLine(line: string): { key: string | null; value: string } {
  const idx = line.indexOf(':')
  if (idx === -1) return { key: null, value: '' }

  const left = line.slice(0, idx)
  const value = line.slice(idx + 1)

  const key = left.split(';')[0]?.trim() ?? null
  return { key, value: unescapeIcsText(value) }
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

function icsDateToIso(dt: string): string {
  // Handles:
  // 20260105T081500
  // 20260105T081500Z
  // 20260105 (date-only)
  const zulu = dt.endsWith('Z')
  const raw = zulu ? dt.slice(0, -1) : dt

  if (/^\d{8}$/.test(raw)) {
    const y = raw.slice(0, 4)
    const m = raw.slice(4, 6)
    const d = raw.slice(6, 8)
    // date-only -> midnight local
    return new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0).toISOString()
  }

  if (/^\d{8}T\d{6}$/.test(raw)) {
    const y = Number(raw.slice(0, 4))
    const m = Number(raw.slice(4, 6))
    const d = Number(raw.slice(6, 8))
    const hh = Number(raw.slice(9, 11))
    const mm = Number(raw.slice(11, 13))
    const ss = Number(raw.slice(13, 15))

    // If it's Zulu time, construct as UTC; else treat as local time.
    const date = zulu
      ? new Date(Date.UTC(y, m - 1, d, hh, mm, ss))
      : new Date(y, m - 1, d, hh, mm, ss)

    return date.toISOString()
  }

  // fallback: return as-is (still helpful for debugging)
  return dt
}

function makeId(summary: string, startIso: string, endIso: string, location: string): string {
  const base = `${summary}|${startIso}|${endIso}|${location}`
  // simple non-crypto hash
  let h = 0
  for (let i = 0; i < base.length; i++) {
    h = (h * 31 + base.charCodeAt(i)) >>> 0
  }
  return `evt_${h.toString(16)}`
}

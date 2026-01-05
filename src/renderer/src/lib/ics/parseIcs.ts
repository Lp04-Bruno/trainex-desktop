export type TrainexEvent = {
  id: string
  summary: string
  start: string // ISO
  end: string // ISO
  location?: string
  description?: string
  categories?: string[]
}

export function parseIcsToEvents(icsText: string): TrainexEvent[] {
  const unfolded = unfoldIcsLines(icsText)
  const lines = unfolded.split(/\r?\n/)

  const events: TrainexEvent[] = []
  let inEvent = false
  let current: (Partial<TrainexEvent> & { duration?: string }) | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (line === 'BEGIN:VEVENT') {
      inEvent = true
      current = {}
      continue
    }
    if (line === 'END:VEVENT') {
      if (inEvent && current) {
        const summary = (current.summary ?? '').trim()
        const start = (current.start ?? '').trim()
        const end = (current.end ?? '').trim()

        if (summary && start) {
          const computedEnd = end || computeEndFromDuration(start, current.duration) || start
          const id = makeId(summary, start, computedEnd, current.location ?? '')
          events.push({
            id,
            summary,
            start,
            end: computedEnd,
            location: current.location?.trim() || undefined,
            description: current.description?.trim() || undefined,
            categories: current.categories
          })
        }
      }
      inEvent = false
      current = null
      continue
    }

    if (!inEvent || !current) continue

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
      case 'DURATION':
        current.duration = value
        break
      default:
        break
    }
  }

  events.sort((a, b) => a.start.localeCompare(b.start))
  return events
}

function computeEndFromDuration(startIso: string, duration: string | undefined): string | null {
  if (!duration) return null
  const ms = parseIcsDurationToMs(duration)
  if (ms === null) return null
  const start = new Date(startIso)
  if (Number.isNaN(start.getTime())) return null
  return new Date(start.getTime() + ms).toISOString()
}

function parseIcsDurationToMs(duration: string): number | null {
  const d = duration.trim().toUpperCase()
  if (!d.startsWith('P')) return null

  const re = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
  const m = d.match(re)
  if (!m) return null

  const days = m[1] ? Number(m[1]) : 0
  const hours = m[2] ? Number(m[2]) : 0
  const minutes = m[3] ? Number(m[3]) : 0
  const seconds = m[4] ? Number(m[4]) : 0

  if ([days, hours, minutes, seconds].some((n) => Number.isNaN(n))) return null
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000
}

function unfoldIcsLines(input: string): string {
  const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return normalized.replace(/\n[ \t]/g, '')
}

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
  const zulu = dt.endsWith('Z')
  const raw = zulu ? dt.slice(0, -1) : dt

  if (/^\d{8}$/.test(raw)) {
    const y = raw.slice(0, 4)
    const m = raw.slice(4, 6)
    const d = raw.slice(6, 8)
    return new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0).toISOString()
  }

  if (/^\d{8}T\d{6}$/.test(raw)) {
    const y = Number(raw.slice(0, 4))
    const m = Number(raw.slice(4, 6))
    const d = Number(raw.slice(6, 8))
    const hh = Number(raw.slice(9, 11))
    const mm = Number(raw.slice(11, 13))
    const ss = Number(raw.slice(13, 15))

    const date = zulu
      ? new Date(Date.UTC(y, m - 1, d, hh, mm, ss))
      : new Date(y, m - 1, d, hh, mm, ss)

    return date.toISOString()
  }

  return dt
}

function makeId(summary: string, startIso: string, endIso: string, location: string): string {
  const base = `${summary}|${startIso}|${endIso}|${location}`
  let h = 0
  for (let i = 0; i < base.length; i++) {
    h = (h * 31 + base.charCodeAt(i)) >>> 0
  }
  return `evt_${h.toString(16)}`
}

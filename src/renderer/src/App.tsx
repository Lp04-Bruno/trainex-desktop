import React from 'react'
import { parseIcsToEvents, type TrainexEvent } from './lib/ics/parseIcs'

type DayBucket = {
  key: string // YYYY-MM-DD
  date: Date
  events: TrainexEvent[]
}

function dayKeyFromIso(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

function addDays(date: Date, deltaDays: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + deltaDays)
  return d
}

function App(): React.ReactElement {
  const [events, setEvents] = React.useState<TrainexEvent[]>([])
  const [status, setStatus] = React.useState<string>('Noch keine Datei geladen.')
  const [selectedDayKey, setSelectedDayKey] = React.useState<string | null>(null)

  const openFile = async (): Promise<void> => {
    const content = await window.api.openIcsFile()
    if (!content) return

    try {
      const parsed = parseIcsToEvents(content)
      setEvents(parsed)
      setStatus(`Geladen: ${parsed.length} Termine`)
      setSelectedDayKey(parsed.length > 0 ? dayKeyFromIso(parsed[0].start) : null)
      console.log('Parsed events:', parsed)
    } catch (e) {
      console.error(e)
      setStatus('Fehler beim Parsen der ICS-Datei. Siehe Konsole.')
    }
  }

  const buckets = React.useMemo<DayBucket[]>(() => {
    const map = new Map<string, TrainexEvent[]>()
    for (const ev of events) {
      const key = dayKeyFromIso(ev.start)
      const list = map.get(key)
      if (list) list.push(ev)
      else map.set(key, [ev])
    }

    const keys = Array.from(map.keys()).sort()
    return keys.map((key) => {
      const list = map.get(key) ?? []
      // key is YYYY-MM-DD
      const [y, m, d] = key.split('-').map((n) => Number(n))
      return {
        key,
        date: new Date(y, m - 1, d),
        events: list
      }
    })
  }, [events])

  const selectedBucket = React.useMemo(() => {
    if (!selectedDayKey) return null
    return buckets.find((b) => b.key === selectedDayKey) ?? null
  }, [buckets, selectedDayKey])

  const canNavigate = buckets.length > 0
  const goRelativeDay = (delta: number): void => {
    if (!selectedBucket) return
    const nextDate = addDays(selectedBucket.date, delta)
    const key = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`
    setSelectedDayKey(key)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__title">
          <div className="topbar__h1">TraiNex Desktop</div>
          <div className="topbar__sub">Planeransicht aus TraiNex-ICS (lokal, ohne Server)</div>
        </div>

        <div className="topbar__actions">
          <button className="btn" onClick={openFile}>
            ICS auswählen
          </button>
          <div className="status">{status}</div>
        </div>
      </header>

      <main className="planner">
        <aside className="sidebar">
          <div className="sidebar__header">Tage</div>
          {buckets.length === 0 ? (
            <div className="empty">Lade eine ICS-Datei, um Termine zu sehen.</div>
          ) : (
            <div className="day-list" role="list">
              {buckets.map((b) => {
                const active = b.key === selectedDayKey
                return (
                  <button
                    key={b.key}
                    type="button"
                    className={active ? 'day-item day-item--active' : 'day-item'}
                    onClick={() => setSelectedDayKey(b.key)}
                  >
                    <div className="day-item__label">{formatDayLabel(b.date)}</div>
                    <div className="day-item__meta">{b.events.length} Termine</div>
                  </button>
                )
              })}
            </div>
          )}
        </aside>

        <section className="agenda">
          <div className="agenda__header">
            <div className="agenda__title">
              {selectedBucket ? formatDayLabel(selectedBucket.date) : 'Agenda'}
            </div>

            <div className="agenda__nav">
              <button
                className="btn btn--ghost"
                onClick={() => goRelativeDay(-1)}
                disabled={!canNavigate}
              >
                ←
              </button>
              <button
                className="btn btn--ghost"
                onClick={() => goRelativeDay(1)}
                disabled={!canNavigate}
              >
                →
              </button>
            </div>
          </div>

          {selectedBucket && selectedBucket.events.length > 0 ? (
            <div className="event-list" role="list">
              {selectedBucket.events.map((ev) => (
                <div key={ev.id} className="event-card" role="listitem">
                  <div className="event-card__time">
                    {formatTime(ev.start)}–{formatTime(ev.end)}
                  </div>
                  <div className="event-card__body">
                    <div className="event-card__title">{ev.summary}</div>
                    {ev.location && <div className="event-card__location">{ev.location}</div>}
                    {ev.description && <div className="event-card__desc">{ev.description}</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">Keine Termine für diesen Tag.</div>
          )}
        </section>
      </main>
    </div>
  )
}

export default App

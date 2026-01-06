import React from 'react'
import { parseIcsToEvents, type TrainexEvent } from './lib/ics/parseIcs'

type DayBucket = {
  key: string
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

function formatStamp(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}${m}${day}-${hh}${mm}`
}

function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

function eventsToCsv(events: TrainexEvent[]): string {
  const header = ['start', 'end', 'summary', 'location', 'description', 'categories']
  const rows = events.map((ev) => {
    const categories = ev.categories?.join(', ') ?? ''
    return [ev.start, ev.end, ev.summary, ev.location ?? '', ev.description ?? '', categories].map(
      csvEscape
    )
  })
  return [header.join(','), ...rows.map((r) => r.join(','))].join('\n')
}

function App(): React.ReactElement {
  const [events, setEvents] = React.useState<TrainexEvent[]>([])
  const [status, setStatus] = React.useState<string>('Noch keine Datei geladen.')
  const [selectedDayKey, setSelectedDayKey] = React.useState<string | null>(null)
  const [activeView, setActiveView] = React.useState<'planner' | 'settings'>('planner')
  const today = React.useMemo(() => new Date(), [])
  const [syncUsername, setSyncUsername] = React.useState<string>('')
  const [syncPassword, setSyncPassword] = React.useState<string>('')
  const [syncDay, setSyncDay] = React.useState<number>(today.getDate())
  const [syncMonth, setSyncMonth] = React.useState<number>(today.getMonth() + 1)
  const [syncYear, setSyncYear] = React.useState<number>(today.getFullYear())
  const [syncBusy, setSyncBusy] = React.useState<boolean>(false)
  const [rememberUsername, setRememberUsername] = React.useState<boolean>(true)
  const syncBusyRef = React.useRef<boolean>(false)

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem('trainex.sync.username')
      if (saved) setSyncUsername(saved)
    } catch {
      /* ignore */
    }
  }, [])

  React.useEffect(() => {
    syncBusyRef.current = syncBusy
  }, [syncBusy])

  React.useEffect(() => {
    const unsub = window.api.onSyncStatus((text) => {
      if (!syncBusyRef.current) return
      setStatus(text)
    })
    return () => {
      unsub()
    }
  }, [])

  const applyIcsContent = (content: string): void => {
    const parsed = parseIcsToEvents(content)
    setEvents(parsed)
    setStatus(
      parsed.length === 0
        ? 'Geladen: 0 Termine (ICS evtl. leer/inkompatibel – siehe Log/last-sync.ics)'
        : `Geladen: ${parsed.length} Termine`
    )
    setSelectedDayKey(parsed.length > 0 ? dayKeyFromIso(parsed[0].start) : null)
    console.log('Parsed events:', parsed)
  }

  const openFile = async (): Promise<void> => {
    const content = await window.api.openIcsFile()
    if (!content) return

    try {
      applyIcsContent(content)
    } catch (e) {
      console.error(e)
      setStatus('Fehler beim Parsen der ICS-Datei. Siehe Konsole.')
    }
  }

  const loadLast = async (): Promise<void> => {
    const content = await window.api.loadLastIcs()
    if (!content) {
      setStatus('Kein lokaler Cache vorhanden.')
      return
    }

    try {
      applyIcsContent(content)
      setStatus((prev) => `${prev} (aus Cache)`)
    } catch (e) {
      console.error(e)
      setStatus('Fehler beim Parsen der Cache-ICS. Siehe Konsole.')
    }
  }

  const clearCache = async (): Promise<void> => {
    const ok = await window.api.clearCache()
    if (!ok) {
      setStatus('Cache konnte nicht gelöscht werden.')
      return
    }
    setStatus('Cache gelöscht.')
  }

  const syncNow = async (): Promise<void> => {
    if (!syncUsername || !syncPassword) {
      setStatus('Bitte Login und Passwort eingeben.')
      return
    }

    if (rememberUsername) {
      try {
        window.localStorage.setItem('trainex.sync.username', syncUsername)
      } catch {
        /* ignore */
      }
    }

    setSyncBusy(true)
    setStatus('Sync läuft…')
    try {
      const res = await window.api.syncTrainexIcs({
        username: syncUsername,
        password: syncPassword,
        day: syncDay,
        month: syncMonth,
        year: syncYear
      })

      if (!res.ok) {
        setStatus(res.hint ? `${res.error} (${res.hint})` : res.error)
        return
      }

      applyIcsContent(res.icsText)
      setStatus((prev) => `${prev} (Sync)`)
    } catch (e) {
      console.error(e)
      setStatus('Sync fehlgeschlagen. Siehe Konsole.')
    } finally {
      setSyncBusy(false)
    }
  }

  const exportJson = async (): Promise<void> => {
    if (events.length === 0) {
      setStatus('Keine Termine zum Exportieren.')
      return
    }

    const suggestedName = `trainex-events-${formatStamp(new Date())}.json`
    const jsonText = JSON.stringify(events, null, 2)
    const res = await window.api.exportJson(suggestedName, jsonText)
    if (res.ok) setStatus(`Exportiert: ${res.path}`)
  }

  const exportCsv = async (): Promise<void> => {
    if (events.length === 0) {
      setStatus('Keine Termine zum Exportieren.')
      return
    }

    const suggestedName = `trainex-events-${formatStamp(new Date())}.csv`
    const csvText = eventsToCsv(events)
    const res = await window.api.exportCsv(suggestedName, csvText)
    if (res.ok) setStatus(`Exportiert: ${res.path}`)
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
          <div className="topbar__sub">Dein Stundenplan aus TraiNex – offline als Planer</div>
        </div>

        <div className="topbar__actions">
          <button className="btn btn--ghost" onClick={openFile}>
            ICS importieren
          </button>
          <button className="btn btn--ghost" onClick={loadLast}>
            Letzte laden
          </button>
          <button
            className={activeView === 'settings' ? 'btn' : 'btn btn--ghost'}
            onClick={() => setActiveView(activeView === 'settings' ? 'planner' : 'settings')}
          >
            Einstellungen
          </button>
          <div className="status" title={status}>
            {status}
          </div>
        </div>
      </header>

      {activeView === 'settings' ? (
        <main className="settings">
          <section className="settings__panel">
            <div className="settings__title">Einstellungen</div>
            <div className="settings__subtitle">
              Melde dich an, um deinen Stundenplan direkt aus TraiNex zu laden.
            </div>

            <div className="settings__section">
              <div className="settings__sectionTitle">Login & Sync</div>
              <div className="settings__grid">
                <input
                  className="input"
                  type="text"
                  value={syncUsername}
                  onChange={(e) => setSyncUsername(e.target.value)}
                  placeholder="TraiNex Login"
                  autoComplete="username"
                />
                <input
                  className="input"
                  type="password"
                  value={syncPassword}
                  onChange={(e) => setSyncPassword(e.target.value)}
                  placeholder="TraiNex Passwort"
                  autoComplete="current-password"
                />

                <div className="sync__row">
                  <input
                    className="input input--small"
                    type="number"
                    value={syncDay}
                    onChange={(e) => setSyncDay(Number(e.target.value))}
                    min={1}
                    max={31}
                    aria-label="Tag"
                  />
                  <input
                    className="input input--small"
                    type="number"
                    value={syncMonth}
                    onChange={(e) => setSyncMonth(Number(e.target.value))}
                    min={1}
                    max={12}
                    aria-label="Monat"
                  />
                  <input
                    className="input input--small"
                    type="number"
                    value={syncYear}
                    onChange={(e) => setSyncYear(Number(e.target.value))}
                    min={2000}
                    max={2100}
                    aria-label="Jahr"
                  />
                </div>

                <label className="settings__checkbox">
                  <input
                    type="checkbox"
                    checked={rememberUsername}
                    onChange={(e) => setRememberUsername(e.target.checked)}
                  />
                  Login merken (nur Benutzername)
                </label>

                <button className="btn" onClick={syncNow} disabled={syncBusy}>
                  {syncBusy ? 'Stundenplan wird geladen…' : 'Stundenplan laden'}
                </button>
                <div className="sync__hint">Passwort wird nicht gespeichert.</div>
              </div>
            </div>

            <div className="settings__section">
              <div className="settings__sectionTitle">Export</div>
              <div className="settings__row">
                <button
                  className="btn btn--ghost"
                  onClick={exportJson}
                  disabled={events.length === 0}
                >
                  Export JSON
                </button>
                <button
                  className="btn btn--ghost"
                  onClick={exportCsv}
                  disabled={events.length === 0}
                >
                  Export CSV
                </button>
              </div>
              <div className="settings__hint">Exportiert die aktuell geladenen Termine.</div>
            </div>

            <div className="settings__section">
              <div className="settings__sectionTitle">Cache</div>
              <div className="settings__row">
                <button className="btn btn--ghost" onClick={clearCache}>
                  Cache löschen
                </button>
              </div>
              <div className="settings__hint">Der Cache ist die zuletzt geladene ICS-Datei.</div>
            </div>
          </section>
        </main>
      ) : (
        <main className="planner">
          <aside className="sidebar">
            <div className="sidebar__header">Stundenplan</div>
            <div className="sync">
              <div className="sync__hint">
                Tipp: Öffne <b>Einstellungen</b> und lade deinen Stundenplan direkt aus TraiNex.
              </div>
              <button className="btn" onClick={() => setActiveView('settings')}>
                Zu den Einstellungen
              </button>
            </div>

            <div className="sidebar__header">Tage</div>
            {buckets.length === 0 ? (
              <div className="empty">Lade deinen Stundenplan, um Termine zu sehen.</div>
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
      )}
    </div>
  )
}

export default App

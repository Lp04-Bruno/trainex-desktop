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

function formatTermineCount(count: number): string {
  return count === 1 ? '1 Termin' : `${count} Termine`
}

function App(): React.ReactElement {
  const [events, setEvents] = React.useState<TrainexEvent[]>([])
  const [status, setStatus] = React.useState<string>('Noch keine Datei geladen.')
  const [selectedDayKey, setSelectedDayKey] = React.useState<string | null>(null)
  const [activeView, setActiveView] = React.useState<'planner' | 'settings'>('planner')
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState<boolean>(false)
  const [lastLoadSource, setLastLoadSource] = React.useState<
    'none' | 'import' | 'cache' | 'sync' | 'reload' | 'auto'
  >('none')
  const today = React.useMemo(() => new Date(), [])
  const [syncUsername, setSyncUsername] = React.useState<string>('')
  const [syncPassword, setSyncPassword] = React.useState<string>('')
  const [syncDay, setSyncDay] = React.useState<number>(today.getDate())
  const [syncMonth, setSyncMonth] = React.useState<number>(today.getMonth() + 1)
  const [syncYear, setSyncYear] = React.useState<number>(today.getFullYear())
  const [syncBusy, setSyncBusy] = React.useState<boolean>(false)
  const [savePassword, setSavePassword] = React.useState<boolean>(false)
  const [autoRefreshEnabled, setAutoRefreshEnabled] = React.useState<boolean>(false)
  const [canEncrypt, setCanEncrypt] = React.useState<boolean>(false)
  const [hasSavedPassword, setHasSavedPassword] = React.useState<boolean>(false)
  const [lastReloadSuccessMs, setLastReloadSuccessMs] = React.useState<number>(0)
  const [cooldownTick, setCooldownTick] = React.useState<number>(0)
  const syncBusyRef = React.useRef<boolean>(false)
  const [verifiedCredKey, setVerifiedCredKey] = React.useState<string>('')
  const [loadedSettings, setLoadedSettings] = React.useState<{
    username: string
    hasSavedPassword: boolean
    autoRefreshEnabled: boolean
  } | null>(null)

  const [toast, setToast] = React.useState<{
    kind: 'error' | 'success' | 'info'
    message: string
  } | null>(null)
  const [toastVisible, setToastVisible] = React.useState<boolean>(false)
  const toastTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (lastReloadSuccessMs === 0) return
    const id = window.setInterval(() => {
      if (Date.now() - lastReloadSuccessMs >= 5 * 60 * 1000) {
        window.clearInterval(id)
        setCooldownTick((x) => x + 1)
        return
      }
      setCooldownTick((x) => x + 1)
    }, 1_000)
    return () => {
      window.clearInterval(id)
    }
  }, [lastReloadSuccessMs])

  const showToast = React.useCallback(
    (kind: 'error' | 'success' | 'info', message: string): void => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current)
        toastTimerRef.current = null
      }

      setToast({ kind, message })
      setToastVisible(true)

      toastTimerRef.current = window.setTimeout(() => {
        setToastVisible(false)
        toastTimerRef.current = window.setTimeout(() => {
          setToast(null)
          toastTimerRef.current = null
        }, 250)
      }, 6_000)
    },
    []
  )

  const showErrorToast = React.useCallback(
    (message: string): void => {
      showToast('error', message)
    },
    [showToast]
  )

  const showSuccessToast = React.useCallback(
    (message: string): void => {
      showToast('success', message)
    },
    [showToast]
  )

  const showInfoToast = React.useCallback(
    (message: string): void => {
      showToast('info', message)
    },
    [showToast]
  )

  const currentCredKey = `${syncUsername}\n${syncPassword}`
  const credentialsVerified = verifiedCredKey.length > 0 && verifiedCredKey === currentCredKey

  const passwordMask = '••••••••'
  const passwordMaskedPlaceholder = hasSavedPassword && syncPassword.length === 0
  const passwordFieldValue = passwordMaskedPlaceholder ? passwordMask : syncPassword

  const getTodayParts = React.useCallback((): { day: number; month: number; year: number } => {
    const d = new Date()
    return { day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() }
  }, [])

  React.useEffect(() => {
    const mkKey = (d: { day: number; month: number; year: number }): string =>
      `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`

    let lastKey = mkKey(getTodayParts())
    const id = window.setInterval(() => {
      const nowParts = getTodayParts()
      const key = mkKey(nowParts)
      if (key === lastKey) return
      lastKey = key
      setSyncDay(nowParts.day)
      setSyncMonth(nowParts.month)
      setSyncYear(nowParts.year)
      showInfoToast('Datum wurde auf heute aktualisiert.')
    }, 60_000)

    return () => {
      window.clearInterval(id)
    }
  }, [getTodayParts, showInfoToast])

  const applyIcsContent = React.useCallback(
    (content: string, source: 'import' | 'cache' | 'sync' | 'reload' | 'auto'): void => {
      const parsed = parseIcsToEvents(content)
      setEvents(parsed)
      setStatus(
        parsed.length === 0
          ? 'Geladen: 0 Termine (ICS evtl. leer/inkompatibel – siehe Log/last-sync.ics)'
          : `Geladen: ${formatTermineCount(parsed.length)}`
      )
      setSelectedDayKey(parsed.length > 0 ? dayKeyFromIso(parsed[0].start) : null)
      setHasLoadedOnce(true)
      setLastLoadSource(source)
      console.log('Parsed events:', parsed)
    },
    []
  )

  React.useEffect(() => {
    let didSet = false

    const init = async (): Promise<void> => {
      try {
        const s = await window.api.getSettings()
        setCanEncrypt(s.canEncrypt)
        setAutoRefreshEnabled(s.autoRefreshEnabled)
        setHasSavedPassword(s.hasSavedPassword)
        setSavePassword(s.hasSavedPassword)
        setLoadedSettings({
          username: s.username ?? '',
          hasSavedPassword: s.hasSavedPassword,
          autoRefreshEnabled: s.autoRefreshEnabled
        })
        if (s.username) {
          setSyncUsername(s.username)
          didSet = true
        }
      } catch {
        /* ignore */
      }

      if (didSet) return
      try {
        const saved = window.localStorage.getItem('trainex.sync.username')
        if (saved) setSyncUsername(saved)
      } catch {
        /* ignore */
      }
    }

    void init()
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

  React.useEffect(() => {
    const unsub = window.api.onSyncResult((payload) => {
      if (!payload.ok) return
      if (payload.source !== 'auto') return
      try {
        applyIcsContent(payload.icsText, 'auto')
        setStatus((prev) => `${prev} (Auto)`)
      } catch (e) {
        console.error(e)
        setStatus('Auto-Update: Fehler beim Parsen. Siehe Konsole.')
      }
    })

    return () => {
      unsub()
    }
  }, [applyIcsContent])

  const openFile = async (): Promise<void> => {
    const content = await window.api.openIcsFile()
    if (!content) return

    try {
      applyIcsContent(content, 'import')
    } catch (e) {
      console.error(e)
      setStatus('Fehler beim Parsen der ICS-Datei. Siehe Konsole.')
      showErrorToast('Fehler beim Parsen der ICS-Datei.')
    }
  }

  const loadLast = async (): Promise<void> => {
    const content = await window.api.loadLastIcs()
    if (!content) {
      setStatus('Kein lokaler Cache vorhanden.')
      return
    }

    try {
      applyIcsContent(content, 'cache')
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
      showErrorToast('Cache konnte nicht gelöscht werden.')
      return
    }
    setStatus('Cache gelöscht.')
  }

  const syncNow = async (): Promise<void> => {
    if (!syncUsername) {
      setStatus('Bitte Login eingeben.')
      showErrorToast('Bitte Login eingeben.')
      return
    }

    const shouldUseSaved = syncPassword.length === 0 && hasSavedPassword
    if (!shouldUseSaved && syncPassword.length === 0) {
      setStatus('Bitte Passwort eingeben.')
      showErrorToast('Bitte Passwort eingeben.')
      return
    }

    try {
      window.localStorage.setItem('trainex.sync.username', syncUsername)
    } catch {
      /* ignore */
    }

    setSyncBusy(true)
    setStatus('Sync läuft…')
    try {
      const res = shouldUseSaved
        ? await window.api.syncTrainexIcsSaved({
            day: syncDay,
            month: syncMonth,
            year: syncYear
          })
        : await window.api.syncTrainexIcs({
            username: syncUsername,
            password: syncPassword,
            day: syncDay,
            month: syncMonth,
            year: syncYear
          })

      if (!res.ok) {
        setStatus(res.hint ? `${res.error} (${res.hint})` : res.error)
        showErrorToast(res.error)
        return
      }

      applyIcsContent(res.icsText, 'sync')
      setStatus((prev) => `${prev} (Sync)`)
      if (!shouldUseSaved) setVerifiedCredKey(currentCredKey)
      showSuccessToast('Stundenplan geladen. Du kannst ihn jetzt in der Startseite ansehen.')
    } catch (e) {
      console.error(e)
      setStatus('Sync fehlgeschlagen. Siehe Konsole.')
      showErrorToast('Sync fehlgeschlagen.')
    } finally {
      setSyncBusy(false)
    }
  }

  const syncSavedNow = async (): Promise<void> => {
    const now = Date.now()
    if (now - lastReloadSuccessMs < 5 * 60 * 1000) {
      const remainingMs = 5 * 60 * 1000 - (now - lastReloadSuccessMs)
      const remainingMin = Math.ceil(remainingMs / 60_000)
      setStatus(
        `Bitte warte noch ${remainingMin} min, bevor du erneut neu lädst (5 Minuten Cooldown).`
      )
      return
    }

    setSyncBusy(true)
    setStatus('Stundenplan wird geladen…')
    try {
      const res = await window.api.syncTrainexIcsSaved({
        day: syncDay,
        month: syncMonth,
        year: syncYear
      })

      if (!res.ok) {
        setStatus(res.hint ? `${res.error} (${res.hint})` : res.error)
        showErrorToast(res.error)
        return
      }

      applyIcsContent(res.icsText, 'reload')
      setStatus((prev) => `${prev} (Aktualisiert)`)
      setLastReloadSuccessMs(now)
      showSuccessToast('Stundenplan aktualisiert. Du kannst ihn jetzt in der Startseite ansehen.')
    } catch (e) {
      console.error(e)
      setStatus('Aktualisierung fehlgeschlagen. Siehe Konsole.')
      showErrorToast('Aktualisierung fehlgeschlagen.')
    } finally {
      setSyncBusy(false)
    }
  }

  const reloadCooldownMs = 5 * 60 * 1000
  const reloadRemainingMs =
    lastReloadSuccessMs > 0 ? Math.max(0, reloadCooldownMs - (Date.now() - lastReloadSuccessMs)) : 0
  const reloadCoolingDown = reloadRemainingMs > 0
  const reloadRemainingMin = reloadCoolingDown ? Math.ceil(reloadRemainingMs / 60_000) : 0
  void cooldownTick

  const saveSettings = async (): Promise<void> => {
    const wantsPassword = savePassword
    const autoEnabled = autoRefreshEnabled

    if (wantsPassword && !canEncrypt) {
      setStatus('Verschlüsselung ist auf diesem System nicht verfügbar.')
      showErrorToast('Verschlüsselung ist auf diesem System nicht verfügbar.')
      return
    }

    if (wantsPassword && !hasSavedPassword && !credentialsVerified) {
      setStatus(
        'Bitte zuerst einmal erfolgreich synchronisieren, bevor du die Login-Daten speicherst.'
      )
      showErrorToast(
        'Bitte zuerst einmal erfolgreich synchronisieren, bevor du die Login-Daten speicherst.'
      )
      return
    }

    const passwordToSave = syncPassword ? syncPassword : undefined

    setStatus('Einstellungen werden gespeichert…')
    try {
      const res = await window.api.setSettings({
        username: syncUsername,
        savePassword: wantsPassword,
        password: passwordToSave,
        autoRefreshEnabled: autoEnabled
      })

      if (!res.ok) {
        setStatus(res.error)
        showErrorToast(res.error)
        return
      }

      setCanEncrypt(res.settings.canEncrypt)
      setHasSavedPassword(res.settings.hasSavedPassword)
      setSavePassword(res.settings.hasSavedPassword)
      setAutoRefreshEnabled(res.settings.autoRefreshEnabled)
      setLoadedSettings({
        username: res.settings.username ?? '',
        hasSavedPassword: res.settings.hasSavedPassword,
        autoRefreshEnabled: res.settings.autoRefreshEnabled
      })
      setSyncPassword('')
      setStatus('Einstellungen gespeichert.')
      showSuccessToast('Einstellungen gespeichert.')
    } catch (e) {
      console.error(e)
      setStatus('Einstellungen konnten nicht gespeichert werden.')
      showErrorToast('Einstellungen konnten nicht gespeichert werden.')
    }
  }

  const settingsDirty = React.useMemo(() => {
    if (!loadedSettings) return false
    if (syncUsername !== loadedSettings.username) return true
    if (savePassword !== loadedSettings.hasSavedPassword) return true
    if (autoRefreshEnabled !== loadedSettings.autoRefreshEnabled) return true
    if (syncPassword.length > 0) return true
    return false
  }, [loadedSettings, syncUsername, savePassword, autoRefreshEnabled, syncPassword])

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
      {toast && (
        <div
          className={
            toastVisible ? `toast toast--show toast--${toast.kind}` : `toast toast--${toast.kind}`
          }
          role="alert"
        >
          {toast.message}
        </div>
      )}
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
            {activeView === 'settings' ? 'Startseite' : 'Einstellungen'}
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
                  onChange={(e) => {
                    setSyncUsername(e.target.value)
                    setSavePassword(false)
                    setAutoRefreshEnabled(false)
                    setVerifiedCredKey('')
                  }}
                  placeholder="TraiNex Login"
                  autoComplete="username"
                />
                <input
                  className="input"
                  type="password"
                  value={passwordFieldValue}
                  onChange={(e) => {
                    const nextValue = e.target.value
                    if (passwordMaskedPlaceholder) {
                      if (nextValue.startsWith(passwordMask)) {
                        setSyncPassword(nextValue.slice(passwordMask.length))
                      } else {
                        setSyncPassword(nextValue)
                      }
                    } else {
                      setSyncPassword(nextValue)
                    }
                    setSavePassword(false)
                    setAutoRefreshEnabled(false)
                    setVerifiedCredKey('')
                  }}
                  placeholder="TraiNex Passwort"
                  autoComplete="current-password"
                />

                <label className="settings__checkbox">
                  <input
                    type="checkbox"
                    checked={savePassword}
                    onChange={(e) => setSavePassword(e.target.checked)}
                    disabled={!canEncrypt || (!hasSavedPassword && !credentialsVerified)}
                  />
                  Login-Daten verschlüsselt speichern (inkl. Passwort)
                </label>

                <label className="settings__checkbox">
                  <input
                    type="checkbox"
                    checked={autoRefreshEnabled}
                    onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
                    disabled={!savePassword && !hasSavedPassword}
                  />
                  Automatisch aktualisieren (alle 2 Stunden, 06–20 Uhr)
                </label>

                <button className="btn" onClick={syncNow} disabled={syncBusy}>
                  {syncBusy ? `Stundenplan wird geladen: ${status}` : 'Stundenplan laden'}
                </button>
                <div className="sync__hint">
                  Passwort wird nicht gespeichert – außer du aktivierst verschlüsseltes Speichern.
                </div>
                <div className="settings__row">
                  <button
                    className={settingsDirty ? 'btn btn--ghost btn--attention' : 'btn btn--ghost'}
                    onClick={saveSettings}
                    disabled={syncBusy}
                  >
                    Einstellungen speichern
                  </button>
                </div>

                {settingsDirty && (
                  <div className="settings__hint settings__hint--dirty">
                    Ungespeicherte Änderungen – bitte speichern.
                  </div>
                )}

                {!canEncrypt && (
                  <div className="settings__hint">
                    Verschlüsseltes Speichern ist auf diesem System nicht verfügbar.
                  </div>
                )}
                {hasSavedPassword && (
                  <div className="settings__hint">
                    Ein Passwort ist bereits gespeichert. Du musst es nicht erneut eingeben.
                  </div>
                )}
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
              <div className="settings__sectionTitle">Datum</div>
              <div className="settings__grid">
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
                <div className="settings__hint">
                  Dieses Datum wird für das Laden aus TraiNex verwendet.
                </div>
              </div>
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
              {!hasLoadedOnce && (
                <div className="sync__hint">
                  Tipp: Öffne <b>Einstellungen</b> und lade deinen Stundenplan direkt aus TraiNex.
                </div>
              )}

              {hasSavedPassword && (
                <button
                  className="btn"
                  onClick={syncSavedNow}
                  disabled={syncBusy || reloadCoolingDown}
                >
                  {syncBusy
                    ? 'Wird aktualisiert…'
                    : reloadCoolingDown
                      ? `Stundenplan neu laden (in ${reloadRemainingMin} min)`
                      : 'Stundenplan neu laden'}
                </button>
              )}

              {!hasSavedPassword && lastLoadSource === 'cache' && (
                <button className="btn" onClick={() => setActiveView('settings')}>
                  Stundenplan vom Server laden
                </button>
              )}

              {!hasLoadedOnce && (
                <button className="btn" onClick={() => setActiveView('settings')}>
                  Zu den Einstellungen
                </button>
              )}
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
                      <div className="day-item__meta">{formatTermineCount(b.events.length)}</div>
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

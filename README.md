# TraiNex Desktop

TraiNex Desktop zeigt deinen Stundenplan als übersichtlichen Planer – direkt auf deinem PC.

Version: 0.1.1 (siehe [CHANGELOG.md](CHANGELOG.md)).

## So benutzt du die App

1. App starten
2. Oben auf **Einstellungen** gehen
3. TraiNex‑Login + Passwort eingeben
4. **Stundenplan laden** klicken
5. Links einen Tag auswählen oder mit ←/→ wechseln

### Wenn du schon eine ICS-Datei hast

Du kannst auch eine Datei importieren:

- Oben auf **ICS importieren** klicken und deine `.ics` auswählen

### Export & Cache

In **Einstellungen** findest du:

- **Export JSON** / **Export CSV** (exportiert die aktuell geladenen Termine)
- **Cache löschen** (löscht die zuletzt geladene Datei)

## Datenschutz

- Die App nutzt dein TraiNex‑Konto nur zum Laden des Stundenplans.
- Das Passwort wird nicht gespeichert.
- Es gibt keinen Server der App – alles läuft lokal.

Details: [PRIVACY.md](PRIVACY.md)

## Entwicklung

```bash
npm install
npm run dev
```

Qualität:

```bash
npm run lint
npm run typecheck
```

Build:

```bash
npm run build:win
```

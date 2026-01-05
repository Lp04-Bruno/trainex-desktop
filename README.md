# TraiNex Desktop

Desktop app (Windows first) to view TraiNex schedules from iCal/ICS — without any server and without central data storage.

Current version: 0.1.0 (see [CHANGELOG.md](CHANGELOG.md)).

## What it does

- Open a local `.ics` file (TraiNex export)
- Display a planner-like agenda
- Optional Auto-Sync: log in to TraiNex and download the iCal/ICS automatically
- Export loaded events as JSON/CSV

## How to use

1. Start the app
2. Click **ICS auswählen** and choose your TraiNex `.ics` export
3. Use the left sidebar to pick a day, or navigate with ←/→
4. Optional: **Letzte laden** uses the local cache; **Cache löschen** clears it

### Auto-Sync

- Enter your TraiNex login and password and click **Sync starten**.
- The status text shows progress (Login → Einsatzplan → Kalender laden).

Sync logs are written to your userData folder:

- `trainex-sync.log` (diagnostics)
- `last-sync.ics` (last downloaded content; useful for debugging)

## Privacy

- No server, no central database.
- Each user uses their own TraiNex login.
- Credentials should not be stored by default (only in RAM during sync).

Details: see [PRIVACY.md](PRIVACY.md).

## Development

### Requirements

- Node.js (LTS recommended)

### Install

```bash
npm install
```

### Run

```bash
npm run dev
```

### Quality checks

```bash
npm run lint
npm run typecheck
```

### Build

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

## Release

- Versioning and release notes: see [CHANGELOG.md](CHANGELOG.md).
- Auto-Sync uses a bundled Chromium (Playwright) so end users do not need to install a browser.

## Contributing

Developer setup and scripts: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).

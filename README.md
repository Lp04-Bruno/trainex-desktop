# TraiNex Desktop

Desktop app (Windows first) to view TraiNex schedules from iCal/ICS — without any server and without central data storage.

## What it does (today)

- Open a local `.ics` file (TraiNex export)
- Parse VEVENT entries (SUMMARY/DTSTART/DTEND/LOCATION/DESCRIPTION/CATEGORIES)
- Display a planner-like day agenda (day list + day navigation)

## Privacy goals

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

## Roadmap (high level)

- MVP 1: Export functions (JSON/CSV) + optional local cache
- MVP 2: Auto-sync via browser automation (Playwright): login → click iCal export → download → parse
- Packaging: Windows installer (.exe) via electron-builder

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).

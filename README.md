# TraiNex Desktop

Desktop app (Windows first) to view TraiNex schedules from iCal/ICS — without any server and without central data storage.

## What it does

- Open a local `.ics` file (TraiNex export)
- Display a planner-like agenda

## How to use

1. Start the app
2. Click **ICS auswählen** and choose your TraiNex `.ics` export
3. Use the left sidebar to pick a day, or navigate with ←/→
4. Optional: **Letzte laden** uses the local cache; **Cache löschen** clears it

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

## Contributing

Developer setup and scripts: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).

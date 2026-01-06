# Privacy

TraiNex Desktop is built to work locally on your computer.
It does not run a separate app server and it does not upload your schedule to a central database.

## What the app does

- It can import an `.ics` file you already have.
- It can optionally log in to TraiNex and download your schedule.

## Credentials (TraiNex login)

- You enter your TraiNex credentials yourself.
- The password is **not stored by default**.
- If you enable **“encrypted credential storage”** in Settings, the app can store your username and password locally in an encrypted form using the operating system’s protection.
- You can disable this at any time.

## Data stored on disk

Depending on how you use the app, it may store:

- A local cache of the last loaded schedule.
- Export files you create (JSON/CSV) in a folder you choose.
- Diagnostic logs to help with troubleshooting Auto‑Sync.
- Your Settings (e.g. username, auto‑refresh preference).

## Auto refresh

If enabled, the app can refresh your schedule automatically while it is running (every 2 hours between 06:00 and 20:00 German time).

## Data sharing

- The app does not send your schedule anywhere except to TraiNex itself when you use Auto‑Sync.
- There is no analytics/tracking built in.

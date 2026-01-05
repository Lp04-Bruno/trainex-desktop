# Privacy

This app is designed to work without a server and without central data storage.

## Credentials

- TraiNex credentials are intended to be entered by each user.
- By default, credentials should not be stored on disk.
- When auto-sync is implemented, credentials should only be kept in memory (RAM) during a sync session.

## Data on disk

- The app currently reads an `.ics` file selected by the user.
- Future optional features may store a local cache under the OS user profile (Electron `userData`).
- No data is uploaded unless you explicitly add such functionality.

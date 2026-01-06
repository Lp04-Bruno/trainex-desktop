# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-01-06

### Added

- Planner-style UI (day list + agenda view)
- Open local TraiNex `.ics` exports
- Local cache (load last / clear)
- Export events as JSON/CSV
- Auto-Sync (logs in to TraiNex and downloads the iCal/ICS export)
- Persistent sync log file under the app userData folder

### Fixed

- Robust ICS text decoding (UTF-8 vs Windows-1252; UTF-16 BOM handling)
- Windows Chromium cache permission issues by using an app-local cache directory

### Notes

- Auto-Sync uses a bundled Chromium (Playwright) so end users do not need to install a browser.

## [0.1.1] - 2026-01-06

### Added

- Settings screen as the main workflow (login, sync, export, cache)
- Optional encrypted credential storage (username + password) using OS encryption (Electron `safeStorage`)
- Manual "Stundenplan neu laden" button on the planner with a 5-minute cooldown
- Automatic refresh while the app is open (every 2 hours, 06-20 Europe/Berlin)
- Toast notifications (success/error/info) with subtle slide-in animation
- Date section for selecting the TraiNex download date; auto-updates on day change

### Changed

- Improved sync progress/status text in UI
- Sidebar behavior: onboarding hint hides after first successful load; cache-only state offers a clear path to fetch from server

### Fixed

- Correct singular/plural for "Termin" vs "Termine"
- Prevent unintended extra reloads by only starting cooldown after a successful update

### Docs

- Updated `PRIVACY.md` and `SECURITY.md` to reflect current behavior and contact information

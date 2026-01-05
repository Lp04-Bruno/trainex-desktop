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

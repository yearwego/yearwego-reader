# Changelog

Changes you can see in the YearWeGo Reader, newest first. Each released version of `dist/yearwego-reader.html` gets its own heading, with the SHA-256 listed in the README for that version.

## Unreleased

### Changed

- The browser tab shows the YearWeGo Y mark, the same icon as yearwego.com, in place of a plain green ring.

## 2026-11-12

### Added

- The reader is online at reader.yearwego.com. The site serves the same file as `dist/yearwego-reader.html`, byte for byte.
- A Light, Dark, and System switch in the footer.
- The wordmark links to yearwego.com.

### Changed

- A new look that matches yearwego.com and the app: yearwego.com’s fonts, a drop area for your backup, a button to show your passphrase, and a checklist of each step while your backup opens.
- Your Logbook looks like it does in the app, with a player for each recording.

## 1.0.0 — 2026-10-30

### Added

- Open a YearWeGo backup on your own computer, offline, with your passphrase. Read your Logbook, play your recordings, and download everything as one zip.
- The license texts of the reader and every library it bundles, under **Licenses** at the foot of the page.
- `npm run verify` checks that a saved copy of the reader matches this source. The page ships unminified so you can read it.

# Changelog

Changes you can see in the YearWeGo Reader, newest first. Each released version of `dist/yearwego-reader.html` gets its own heading, with the SHA-256 listed in the README for that version.

## Unreleased

### Added

- Backups from the app’s journeys build show each milestone’s journey, and Where you’re headed is the milestone the app was working on. The download names each milestone’s journey too, with the others still open marked Open.
- Each milestone shows its counts, such as books read or a mile time, with the total or the latest reading, where it started, and its goal. The download lists every count and each number entered, with the day and whether it came from a check-in.

### Changed

- Opens backups from the newest YearWeGo builds, which keep each encrypted value in one piece with what it needs to open. Backups from earlier builds open as before.

- Your passphrase opens a backup however you type the gaps between the words: spaces, long dashes, a full stop, or a line break, and with capitals, as the app accepts.

- The browser tab shows the YearWeGo Y mark, the same icon as yearwego.com, in place of a plain green ring.

### Fixed

- Each answer shows the question it answered: after “I did it” in the app, How did you do it?, What are you glad you did?, What did you learn?, or How did it go?, and a journey’s why, its reason for being set aside, and the weekly look’s two questions.

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

# YearWeGo Reader

Open a YearWeGo backup on your own computer, without the app. You get your Logbook back: where you’re headed, every day’s intention, whether you did it, your answer, and every recording. One button saves all of it as ordinary files.

- **One file.** `dist/yearwego-reader.html` holds everything it needs. Save it anywhere and open it in Safari, Chrome, Firefox, or Edge, even with no internet connection.
- **Your backup stays with you.** The page has a Content-Security-Policy with `connect-src 'none'`, so it cannot send anything anywhere. You can check this in your browser’s developer tools.
- **Read only.** It never changes your backup.
- **Use a computer.** Your backup and both passphrase steps need more memory than most phones give a web page.

## How to use it

1. Keep two things: your backup file (it ends in `.yearwego.backup.zip`) and your passphrase (eight words with dashes between them).
2. Open `yearwego-reader.html` in a browser on a computer.
3. Choose your backup file, type your passphrase, and select **Open**. Two steps take a few seconds each while your passphrase unlocks the backup and then your words.
4. Read and play your entries, or select **Download everything** for one zip with:
   - `recordings/<date>-<kind>.aac`, every recording as an AAC audio file;
   - `logbook.md`, every day in words, newest first, with where you’re headed at the top;
   - `logbook.json`, the same as plain JSON.

If something unzipped your backup into two files (`….yearwego.header.json` and `….yearwego.data.encrypted`), choose both at once.

If your backup was made before October 2, 2026, right after you replaced a lost passphrase, the reader may ask for the passphrase you used before. That is expected.

## Check your copy

The SHA-256 of `dist/yearwego-reader.html` for this version is:

<!-- sha256 -->`c99aa06782dbb6a55fbf3d2e8d4ec53db536306771155c3052ec29fdf300b19f`<!-- /sha256 -->

On a Mac or Linux: `shasum -a 256 yearwego-reader.html`. On Windows: `certutil -hashfile yearwego-reader.html SHA256`.

## The format

`spec/v1.md` describes every layer of a backup: the zip, the header, the key stretching (Argon2id), the encryption (XChaCha20-Poly1305), the database tables, and the audio container. `spec/vectors.json` holds known-answer test vectors. Both are copies; the source of truth lives with the app and changes in the same change as the format.

## Build and verify

Requires Node 22 or newer.

```sh
npm ci
npm test        # vectors and golden archives
npm run build   # type-checks, builds dist/yearwego-reader.html, and writes its SHA-256 here
```

- `src/core/` is the reader itself, with no DOM: open the archive, check the manifest, unlock the keys, read the database, decrypt words and audio, and build the export.
- `src/ui/` is the one page.
- `tests/` runs the core in Node against `spec/vectors.json` and the archives in `fixtures/`.
- `fixtures/` holds golden archives made by the app’s own backup code with made-up entries and the passphrase `TEST`. They contain no one’s real data.

Pinned libraries: libsodium.js (sumo build, for Argon2id), sql.js (SQLite in WebAssembly), and fflate (zip). The build reads each library’s own license file and puts the texts in the page, under **Licenses** at the foot, and in a comment at the top of the file; it fails if anything bundled has no license notice.

## License

MIT. See `LICENSE`.

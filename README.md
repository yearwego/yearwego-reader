# YearWeGo Reader

Open a YearWeGo backup on your own computer, without the app. You get your Logbook back: where you’re headed, every day’s intention, whether you did it, your answer, and every recording. One button saves all of it as ordinary files.

- **One file.** `dist/yearwego-reader.html` holds everything it needs. Save it anywhere and open it in Safari, Chrome, Firefox, or Edge, even with no internet connection.
- **Your backup stays with you.** The page is built not to send anything over the network. Its Content-Security-Policy (`connect-src 'none'`) makes your browser refuse any network request, upload, or connection the page tries, and the code never navigates away. You can see the policy in your browser’s developer tools, and **How to audit** below shows how to check the rest.
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

<!-- sha256 -->`614cc943f61efad84022680234c83ac5fa30b3e6ea3fd7baf88ee74f6efdfc89`<!-- /sha256 -->

On a Mac or Linux: `shasum -a 256 yearwego-reader.html`. On Windows: `certutil -hashfile yearwego-reader.html SHA256`.

## How to audit

You don’t have to take our word for any of this. Everything the page does can be checked.

- **Read the code.** `src/` is about 2,000 lines of TypeScript and 330 lines of CSS.
  - `src/core/` (about 1,500 lines) is the reader itself, with no DOM: open the archive, check the manifest, unlock the keys, read the database, decrypt words and audio, and build the export.
  - `src/ui/` (about 500 lines) is the one page: the form, your Logbook, the players, and the download.
  - The built page carries this code unminified, with its names and layout, so what you read in `src/` is what you’ll find in the file.
- **Rebuild it.** `npm ci && npm run build` makes a byte-for-byte identical `dist/yearwego-reader.html`, with the SHA-256 above.
- **Check the live copy.** `curl -o page.html https://yearwego.com/reader/ && npm run verify -- page.html` compares it with this repository, offline:
  - each WebAssembly blob, decoded, byte for byte against the file in the npm package it came from;
  - that the page holds no other WebAssembly;
  - the whole file’s SHA-256 against `dist/yearwego-reader.html.sha256`;
  - with `--rebuild`, the whole file against a fresh build of this checkout.
- **The two blobs are checked, not read.** libsodium (Argon2id and XChaCha20-Poly1305) and SQLite are compiled to WebAssembly and sit in the page as base64. Decoded, each is identical to a file in its pinned npm package. The same table is in a comment at the top of the page.

<!-- wasm -->
| Package | Version | File | Bytes | SHA-256 of the WebAssembly |
| --- | --- | --- | --- | --- |
| libsodium-sumo | 0.8.4 | `dist/modules-sumo-esm/libsodium-sumo.mjs` (as base64) | 284,995 | `29dd7daf12daec2afdf7b73101e50679bfe9c38861aa1f0de50ae505ccba99bd` |
| sql.js | 1.14.2 | `dist/sql-wasm-browser.wasm` | 658,410 | `38c14f6e379210bc942bdc4ebca44e7bfdb4318ecc1c72ca666a28fdce96670a` |
<!-- /wasm -->

- **What your browser blocks.** The Content-Security-Policy refuses every fetch, upload, beacon, and socket (`connect-src 'none'`), anything loaded from elsewhere, including images, fonts, and frames (`default-src 'none'`), and every form submission (`form-action 'none'`).
- **What it can’t block.** No Content-Security-Policy can stop a script from sending the tab to another address, which could carry data in the URL. So the reader is written never to navigate or open a window. To check, run `grep -rnE "location|window\.open|\.click\(|history\." src/ dist/yearwego-reader.html`:
  - the one `.click()` is **Download everything**, on a link to a `blob:` address the page made itself, so it saves a file and goes nowhere;
  - the one `location` is sql.js reading its own address, never changing it;
  - `allocation` is a word in an error check.
- **One more thing grep will find.** libsodium and sql.js each carry an `XMLHttpRequest` loader for web workers. The page never runs it, since both libraries are handed their WebAssembly directly, and `connect-src 'none'` would refuse it.

## The format

`spec/v1.md` describes every layer of a backup: the zip, the header, the key stretching (Argon2id), the encryption (XChaCha20-Poly1305), the database tables, and the audio container. `spec/vectors.json` holds known-answer test vectors. Both are copies; the source of truth lives with the app and changes in the same change as the format.

## Build and verify

Requires Node 22.18 or newer.

```sh
npm ci
npm test        # vectors and golden archives
npm run build   # type-checks, builds dist/yearwego-reader.html, and writes its SHA-256 here
npm run verify -- dist/yearwego-reader.html   # checks a built page; add --rebuild to compare with a fresh build
```

- `src/core/` is the reader itself and `src/ui/` the one page (see **How to audit**).
- `scripts/` builds the page: license notices, the WebAssembly table, and `verify`.
- `tests/` runs the core in Node against `spec/vectors.json` and the archives in `fixtures/`.
- `fixtures/` holds golden archives made by the app’s own backup code with made-up entries and the passphrase `TEST`. They contain no one’s real data.

Pinned libraries: libsodium.js (sumo build, for Argon2id), sql.js (SQLite in WebAssembly), and fflate (zip). The build reads each library’s own license file and puts the texts in the page, under **Licenses** at the foot, and in a comment at the top of the file; it fails if anything bundled has no license notice.

## License

MIT. See `LICENSE`.

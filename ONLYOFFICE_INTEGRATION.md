# ONLYOFFICE E2EE editor integration

Xenode edits Office documents (docx/xlsx/pptx/odt/csv, PDF view-only) **fully
client-side**, with **no ONLYOFFICE Document Server**. Decrypted bytes never
leave the browser; the server only ever stores ciphertext. This is the
CryptPad-pioneered offline pattern, wired into Xenode's E2EE storage.

## How it works

```
React shell (OnlyOfficeEditorShell)
  → decrypt doc client-side (lib/onlyoffice/documentCrypto.ts)
  → createOnlyOfficeAdapter (lib/onlyoffice) loads the vendored engine
  → public/onlyoffice/engine.js  (MAIN window — the trusted bridge/adapter)
       ↕ same-origin postMessage (decrypted bytes CLONED in, never transferred)
  → public/onlyoffice/editor.html  (sandboxed, egress-locked iframe)
       • x2t WASM: docx → Editor.bin  (open) and Editor.bin → docx (save)
       • boots ONLYOFFICE DocsAPI offline (CryptPad api.js shim)
       • plays the Document Server via connectMockServer()
       → ONLYOFFICE's own native ribbon renders in a nested frameEditor
```

- **Open:** `x2t` converts the decrypted docx to ONLYOFFICE's internal
  `Editor.bin`, handed to the editor as an in-memory `blob:` URL.
- **Save:** `editor.asc_nativeGetFile()` returns the live document as a bin
  **string**; `x2t` converts it back to docx; the bytes go to the shell, which
  re-encrypts + uploads (only ciphertext leaves the device).

## Files

**Committed glue** (Xenode's own — small, in git):
- `public/onlyoffice/manifest.json` — `{version, entry}`; its presence is the
  "engine is ready" signal the loader checks.
- `public/onlyoffice/engine.js` — main-window factory implementing
  `OnlyOfficeAdapter` (see `lib/onlyoffice/adapter.ts`) over a postMessage bridge.
- `public/onlyoffice/editor.html` — inner page: x2t + DocsAPI offline + mock server.
- `public/onlyoffice/document_editor_service_worker.js` — no-op SW the editor
  registers during boot (fire-and-forget; provided to silence the 404).

**Vendored AGPL-3.0 assets** (large, gitignored, fetched at build time):
- `public/onlyoffice/{web-apps,sdkjs,fonts}/` — ONLYOFFICE editor (CryptPad build).
- `public/onlyoffice/x2t/` — the x2t WASM converter.
- Fetched by `npm run vendor:onlyoffice` (see `scripts/vendor-onlyoffice.mjs`).
  Re-run after a fresh clone / in CI. `--from-file=<zip>` extracts a
  locally-downloaded zip. AGPL source-offer recorded in `THIRD-PARTY-NOTICE.txt`.

## CSP (next.config.ts, `/onlyoffice/:path*`) — and why it stays E2EE-safe

The editor needs two CSP allowances that look scary but **do not** weaken E2EE:

- `script-src … 'unsafe-eval'` — ONLYOFFICE's template engine + sdkjs compile
  code via `new Function()`. Required, or the editor's module graph stalls.
- `connect-src 'self' blob:` — the editor fetches the decrypted document from an
  in-memory `blob:` URL.

**The E2EE guarantee rests on egress, not on eval.** `connect-src` permits only
`'self'` + `blob:` (both on-device); there is no cross-origin destination, so the
editor can run its own code and read local blobs but can **never** exfiltrate
decrypted bytes. The iframe is also `sandbox="allow-scripts allow-same-origin"`
and served same-origin. This mirrors CryptPad's offline sandbox exactly.

## Manual test checklist

1. `npm run vendor:onlyoffice` (once) → assets present under `public/onlyoffice/`.
2. Restart `npm run dev` (CSP lives in `next.config.ts`; changes need a restart).
3. Open a `.docx` in the editor route (`/editor/<fileId>`), vault unlocked.
   - ✅ ONLYOFFICE's native ribbon + the document content render.
   - ✅ Type an edit → the save indicator shows saving → saved (auto-save).
   - ✅ Reload → edits persisted (decrypts + reopens).
4. Engine self-test (no auth, sample doc): `/onlyoffice/_selftest.html` — the
   green bar should reach `✅ READY` (local-only harness; gitignored).

## Known caveats / follow-ups

- **Browser extensions that inject SES "lockdown"** (MetaMask & other wallets)
  freeze JS intrinsics inside every frame and break ONLYOFFICE. Symptom: the
  editor stalls on its loading skeleton. Workaround: disable the extension for
  this origin, or use a clean profile. Not Xenode-specific.
- **Spreadsheet/presentation service workers**: only the document-editor SW is
  provided. xlsx/pptx editors register a differently-named SW that 404s — it's
  fire-and-forget (non-fatal), but add `spreadsheet_editor_service_worker.js` /
  `presentation_editor_service_worker.js` to silence it.
- **Images/fonts on save**: text round-trips cleanly. Documents with embedded
  images may need the media/font files written into x2t's FS before
  `bin → docx` (see `fetchFonts`/media handling in CryptPad's `outer/x2t.js`).
- **First load downloads ~65 MB** (mostly the 57 MB `x2t.wasm`), then it's
  HTTP-cached (immutable headers on the vendored dirs). Subsequent opens are ~0 bytes.
```

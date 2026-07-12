# Xenode ONLYOFFICE build tooling

This directory describes and builds the browser portion of ONLYOFFICE used by
Xenode Docs v2 and Sheets v2.

The standard Document Server is deliberately not started. Xenode will replace
its plaintext file/conversion/collaboration path with a browser-only bridge,
browser-side x2t WASM, and the existing Xenode E2EE persistence layer.

## Source verification

```powershell
npm run onlyoffice:verify-sources
```

The expected upstream tags and commits are recorded in `release.json`.

## Client bundle

```powershell
npm run onlyoffice:build-client
```

This builds the official document and spreadsheet JavaScript/UI bundles in an
isolated Docker build. The immutable output is written to:

```text
public/internal-editors/onlyoffice/9.4.0.131-xenode.1/
```

Generated artifacts are intentionally ignored by the main Git repository.
Production deployment should publish the directory as a versioned artifact.

This client bundle is not yet a functioning E2EE editor on its own. It becomes
usable only after the x2t WASM and Xenode iframe bridge phases are complete.

## Xenode frame host (iframe bridge)

```powershell
npm run onlyoffice:install-host
```

Copies the checked-in frame host (`tools/onlyoffice/host/host.html` +
`xenode-frame.js`) into the immutable artifact under `xenode/`, so it is served
from the *editor* origin beside `api.js`, and flips `bridgeReady` in
`version.json`. The host speaks the typed protocol in
`lib/spreadsheets/v2/bridge/protocol.ts`. It validates the parent origin, the
per-session nonce, the protocol version, and message types before dispatch, and
transfers binary buffers rather than cloning them.

## x2t browser WASM

```powershell
npm run onlyoffice:build-x2t
```

Compiles ONLYOFFICE `core` (the x2t converter) to browser WASM in an isolated
Emscripten Docker build (`Dockerfile.x2t`), using the `core` commit pinned in
`release.json`. Output lands at:

```text
public/internal-editors/onlyoffice/9.4.0.131-xenode.1/x2t/x2t.js
public/internal-editors/onlyoffice/9.4.0.131-xenode.1/x2t/x2t.wasm
```

and the script flips `x2tReady` in `version.json`. Until this build has run,
`lib/spreadsheets/v2/conversion/browserEngine.ts` reports `x2t_unavailable` and
the editor cleanly falls back to Sheets v1.

## Browser-only E2EE round trip

Once both `bridgeReady` and `x2tReady` are true, the loop is:

```text
encrypted XLSX in B2
  -> XenodeBinaryPersistenceAdapter.loadBinary (browser decrypt)
  -> X2tClient.toEditorBin (xlsx -> Editor.bin, in-browser WASM)
  -> parent bridge OPEN_EDITOR_BIN (transferable ArrayBuffer)
  -> user edits
  -> frame bridge SAVE_BYTES (Editor.bin)
  -> X2tClient.fromEditorBinToXlsx (Editor.bin -> xlsx)
  -> XenodeBinaryPersistenceAdapter.saveBinary (encrypt + revisioned update)
```

No step makes a third-party or plaintext request; the artifact CSP pins
`connect-src 'none'` on the editor origin.

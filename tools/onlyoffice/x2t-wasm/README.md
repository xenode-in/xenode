# x2t → WebAssembly harness (forward-port to 9.4.0.131)

x2t has **no** WebAssembly target in stock ONLYOFFICE `core` — core ships only
Qt (native) and Android x2t builds (`core/X2tConverter/build/{Qt,Android}`). The
only proven browser build is CryptPad's
[onlyoffice-x2t-wasm](https://github.com/cryptpad/onlyoffice-x2t-wasm), which
maintains an Emscripten harness + core patches against **ONLYOFFICE 9.3.0.140**.

Xenode keeps the newer **9.4.0.131** client bundle (for Editor.bin
compatibility with `Dockerfile.client`), so CryptPad's patches must be
**forward-ported** onto the vendored 9.4.0.131 `core`. That port lives here and
is applied by `tools/onlyoffice/Dockerfile.x2t`.

## What must be provided here

```text
tools/onlyoffice/x2t-wasm/
  embuild.sh          # ported build wrapper (qmake .pro -> emscripten)
  pre-js.js           # ported browser pre-js wrapper (defines the module API)
  patches/*.patch     # Emscripten-compat patches applied on top of 9.4.0.131 core
  README.md           # this file
```

`build-x2t.ps1` fails fast until `embuild.sh` and at least one `patches/*.patch`
exist, so the long Docker build never runs against an incomplete port.

## Port checklist

1. Vendor CryptPad's 9.3.0.140 recipe for reference (do not build from it):
   `git clone https://github.com/cryptpad/onlyoffice-x2t-wasm` at a pinned commit
   (record it in `tools/onlyoffice/release.json` under `cryptpad_x2t_wasm`).
2. Diff CryptPad's patched `core` against ONLYOFFICE `v9.3.0.140` to extract the
   Emscripten-compat changes as discrete patches (3rdParty stubs, filesystem
   assumptions, `main` → `main1` entry, ICU/boost/openssl shims).
3. Re-apply each patch onto the vendored `v9.4.0.131` core; resolve rejects
   where the two versions diverged. Keep patches small and one-concern-each.
4. Port `embuild.sh` and `pre-js.js`; confirm the emitted module exports
   `_main1` with `EXPORTED_RUNTIME_METHODS=ccall,FS` (matches
   `lib/spreadsheets/v2/conversion/engine.ts` → `X2T_ENTRY_FUNCTION`).
5. Build: `npm run onlyoffice:build-x2t`. Output lands at
   `public/internal-editors/onlyoffice/9.4.0.131-xenode.1/x2t/` and the script
   flips `x2tReady`.
6. Validate the round trip on the fixture corpus (blank + representative XLSX):
   `xlsx → Editor.bin → xlsx` must reopen in Excel/LibreOffice with the spike
   fixtures preserved, and — critically — the resulting `Editor.bin` must open
   in the 9.4.0.131 sdkjs client. If it does not, the port is not compatible and
   the 9.3.0.140-aligned strategy must be revisited.

## Licensing

CryptPad's patches and ONLYOFFICE core are AGPL. Preserve notices, record the
CryptPad source commit and every applied patch, and keep the port reproducible.
Complete the license/trademark review (plan Phase 0) before distributing.

# x2t → WebAssembly harness (forward-port to 9.4.0.131)

x2t has **no** WebAssembly target in stock ONLYOFFICE `core` — core ships only
Qt (native) and Android x2t builds (`core/X2tConverter/build/{Qt,Android}`). The
only proven browser build is CryptPad's
[onlyoffice-x2t-wasm](https://github.com/cryptpad/onlyoffice-x2t-wasm), which
maintains an Emscripten harness (emsdk 4.0.11 + boost 1.84 + openssl 1.1.1f +
ICU, ~40 Docker stages) against **ONLYOFFICE 9.3.0.140**.

Xenode keeps the newer **9.4.0.131** client bundle (for Editor.bin compatibility
with `Dockerfile.client`), so the harness is **forward-ported** to build against
the vendored 9.4.0.131 `core`.

## What is vendored here (transcribed verbatim from CryptPad)

Pinned source commit: `96886ff143e05471144c4426fb304b4d794370d2`
(recorded in `tools/onlyoffice/release.json` → `patchSources.cryptpad_x2t_wasm`).

```text
tools/onlyoffice/x2t-wasm/
  embuild.sh            # qmake -> emscripten build wrapper (verbatim)
  pre-js.js             # --pre-js: sets noInitialRun + locateFile (verbatim)
  wrap-main.cpp         # main1(xmlPath) entry, appended to X2tConverter main.cpp
  patches/harfbuzz.patch# drops harfbuzz native test programs (verbatim)
  README.md             # this file
```

The build itself is `tools/onlyoffice/Dockerfile.x2t` (transcribed from
CryptPad's Dockerfile at the pinned commit) and is driven by
`npm run onlyoffice:build-x2t`, which assembles a clean context (a junction to
`vendor/onlyoffice/core` + a copy of this harness) so the Dockerfile's many
`COPY core/...` lines stay faithful to upstream.

## The module API (for lib/spreadsheets/v2/conversion)

CryptPad's output is a **classic Emscripten module** (not MODULARIZE): loading
`x2t.js` populates the global `Module`, `pre-js.js` sets `noInitialRun`, and the
converter is invoked as `Module.ccall("main1", "number", ["string"], [xmlPath])`
after writing the input + a `TaskQueueDataConvert` params XML into `Module.FS`.
`browserEngine.ts` and `engine.ts` are wired to exactly this.

## Status: NOT yet built/verified at 9.4.0.131

The recipe is complete and faithful, but the from-source build has not been run
against 9.4.0.131. Expected first-run fixups (the 9.3.0.140 → 9.4.0.131 deltas):

1. **build_tools** — bumped to `v9.4.0.131` in `Dockerfile.x2t`. If any
   3dParty `fetch.py`/`make.py` layout changed, adjust the affected stage.
2. **sed line-edits** — `CssCalculator.pri`, `freetype.pri`, and
   `katana.lex.c` edits may need refreshed patterns if those files moved.
3. **harfbuzz.patch** — offsets/`Makefile.am` may have shifted; refresh if
   `git apply` fails (the Dockerfile falls back to `patch -p1`).
4. **X2tConverter.pro / main.cpp** — confirm `X2tConverter/src/main.cpp` still
   defines `main` (the `wrap-main.cpp` append relies on it) and that the `.pro`
   at `X2tConverter/build/Qt/X2tConverter.pro` still links every module lib.

## Validation gate (before flipping x2tReady in production)

Round-trip the fixture corpus (blank + representative XLSX): `xlsx → Editor.bin
→ xlsx` must reopen in Excel/LibreOffice with fixtures preserved, and — the
critical check — the produced `Editor.bin` must open in the **9.4.0.131 sdkjs**
client. If it does not, this port is incompatible and the 9.3.0.140-aligned
strategy must be reconsidered.

## Licensing

CryptPad's harness and ONLYOFFICE core are AGPL. Preserve notices, keep the
pinned source commit + this transcription reproducible, and complete the
license/trademark review (plan Phase 0) before distributing.

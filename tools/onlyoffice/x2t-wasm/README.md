# x2t WebAssembly harness

Stock ONLYOFFICE does not ship a browser x2t target. Xenode uses the pinned
CryptPad Emscripten harness aligned with ONLYOFFICE `9.3.0.140`.

The classic Emscripten module exposes `Module`, `FS`, and `main1`. Drive adapts
that surface in `apps/drive/lib/office-editor/conversion/engine.ts` and loads it
through `browserEngine.ts`. The release gate is a real browser-only
`xlsx -> Editor.bin -> xlsx` roundtrip with no network egress or plaintext
request.

Harness/source pins and notices live in `tools/onlyoffice/release.json`. Preserve
the CryptPad and ONLYOFFICE AGPL obligations and reproducible build inputs.

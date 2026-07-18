# Xenode ONLYOFFICE tooling

This directory builds and verifies the pinned browser-only Office runtime used
by `apps/drive/lib/office-editor`.

Xenode does not run ONLYOFFICE Document Server. The browser decrypts a workbook,
converts it with x2t WASM, transfers bounded `ArrayBuffer`s through the
exact-origin iframe bridge, then encrypts the exported workbook before the
revisioned save request.

The current artifact version is `9.3.0.140-cryptpad.2-xenode.1`. Generated files
are installed under:

```text
apps/drive/public/internal-editors/onlyoffice/<artifact-version>/
```

Commands:

```powershell
npm run onlyoffice:verify-sources
npm run onlyoffice:build-client
npm run onlyoffice:build-x2t
npm run onlyoffice:install-host
npm run onlyoffice:verify-client
npm run onlyoffice:verify-x2t
```

The frame host implements the protocol in
`apps/drive/lib/office-editor/bridge/protocol.ts`; the conversion loader is
`apps/drive/lib/office-editor/conversion/browserEngine.ts`. Runtime assets must
remain immutable, self-hosted, CSP-restricted, free of third-party requests, and
served from the static-only `edit.xenode.in` origin.

Preserve AGPL notices, pinned upstream commits, build instructions, hashes, and
source availability when distributing the modified runtime.

# Office editor

Xenode uses a pinned, self-hosted CryptPad-patched ONLYOFFICE runtime and x2t
WASM conversion pipeline. Source/build inputs live in `vendor/`, `tools/`, and
`scripts/onlyoffice`; immutable output is installed under
`apps/drive/public/internal-editors/onlyoffice`.

The Drive parent shell decrypts the selected workbook, converts it in the
browser, and transfers bounded buffers to `edit.xenode.in`. The runtime exports
the edited bytes back to the parent, which encrypts and saves them through the
revisioned object update route. Plaintext must never enter fetch payloads,
MongoDB, logs, analytics, or realtime.

The bridge validates exact origin, source window, channel, protocol version,
nonce, message type, and payload size. Outbound messages never use `*`. The
runtime receives no session cookie, key, storage URL, account ID, or unrelated
metadata.

Useful commands:

```powershell
npm run onlyoffice:verify-sources
npm run onlyoffice:build-client
npm run onlyoffice:build-x2t
npm run onlyoffice:install-host
npm run onlyoffice:verify-client
npm run onlyoffice:verify-x2t
```

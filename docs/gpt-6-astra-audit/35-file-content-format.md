# 35 — Authenticated file content format (`xenode-file/1`)

Drive file content and file-key wraps use one AAD-bound format, implemented
once in `@xenode/crypto-core` (`src/file.ts`) and reused by Drive
(`lib/crypto/fileEncryption.ts`) and the media service worker (`public/sw.js`).
It closes the content and key half of F26; metadata binding is tracked
separately.

## Identity

Everything is bound to the object's stable id: the StorageObject `_id`, a
24-hex ObjectId. It is fixed for the life of a file — revisions, version
restore, moves and the Bin keep it — while the storage key changes on every
revision. Uploads learn it before encrypting: a single-blob upload from its
reservation's `sessionId`, a multipart upload by reserving first (the sealed
sizes are computed from the plaintext size). Share and stream routes report it
as `objectId`.

## Content

AES-256-GCM under the file's own random key, a fresh random 96-bit IV per
chunk, 128-bit tags. Each chunk's AAD is the UTF-8 of these fields joined by
U+001F:

```
xenode-file/1 · chunk · <fileId> · <index> · <count>
```

- A file always has at least one chunk, so an empty file is authenticated.
- A single-blob object is chunk 0 of 1 (`iv`).
- A multipart object stores one sealed chunk per part (`chunkIvs`,
  `chunkSize`); the IV list is the authenticated count, and readers check the
  part count and each part's length before decrypting.
- Revisions reuse the file key with a fresh IV; the server already refuses a
  repeated IV for a target.

Reordering, dropping, appending or transplanting chunks, or presenting one
file's ciphertext as another's, fails authentication.

## File-key wraps

| Wrap | Algorithm | Binding |
| --- | --- | --- |
| Personal (`wrappedBy: "user"`) | RSA-OAEP-SHA-256 to the account key | OAEP label `xenode-file/1 · user-key · <fileId>` |
| Workspace (`wrappedBy: "space"`) | AES-GCM under the Space key version | AAD `xenode-file/1 · space-key · <spaceId> · <spaceKeyVersion> · <fileId>` |
| Link, direct and album shares | AES-GCM under the share key | AAD `xenode-file/1 · share-key · <fileId>` |

A wrap therefore opens only for its own file (and, for workspaces, its Space and
key version); a bundle's item keys cannot be swapped between items. Unwrapped
keys are non-extractable except where a caller re-wraps them for a share or
hands bytes to the media service worker.

## Readers

Every reader takes the id from the record it fetched: downloads, previews (full
blob, HD original, inspected first chunk, service-worker and MSE streaming),
version history, the Office editor (load and save, personal, workspace and
direct share), public, direct and album shares, comments and audio sidecars.
None has a plaintext path: Drive content is always encrypted, so a record that
claims otherwise is not rendered.

## Not covered

Names, content types, thumbnails, metadata objects and folder names are not
yet bound to their object (F26 metadata, F25). Data written before this format
does not open; Xenode has no production data, so there is no reader for it.

# 35 — Authenticated file format (`xenode-file/1`)

Drive file content, file-key wraps and file metadata use one AAD-bound format,
implemented once in `@xenode/crypto-core` (`src/file.ts`) and reused by Drive
(`lib/crypto/fileEncryption.ts`) and the media service worker (`public/sw.js`).
It closes F26.

## Identity

Everything is bound to the object's stable id: the StorageObject `_id`, a
24-hex ObjectId. It is fixed for the life of a file — revisions, version
restore, moves and the Bin keep it — while the storage key changes on every
revision. Uploads learn it before encrypting: a single-blob upload from its
reservation's `sessionId`, a multipart upload by reserving first (the sealed
sizes are computed from the plaintext size). A folder's id is chosen by the
client (12 random bytes; the server refuses a malformed or reused id), so its
name can be bound before the record exists. Share and stream routes report it
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

## Metadata

Names (files and folders), content types, tags, thumbnails, metadata objects,
share re-seals and comments are sealed with AES-GCM and the AAD

```
xenode-file/1 · metadata · <fileId> · <purpose>
```

where the purpose is `name`, `content-type`, `tags`, `thumbnail`, `metadata` or
`comment`. Stored values are base64 of `0x04 ‖ IV ‖ ciphertext`. The key is the
Space metadata key for the record's key version, the share key for values
re-sealed for a share, or the file key for comments. A value opens only as its
own file's metadata of the same purpose, so a server cannot show one file's
name, type or thumbnail on another. Readers show the `Encrypted File` sentinel
(or nothing, for a thumbnail) when a value does not open; a thumbnail must also
be a `data:image/` URL. No metadata is ever stored or rendered in plaintext:
tags require the key, and server-supplied thumbnails or retired formats are
refused. An album share's name, which belongs to no file, binds to the share
token.

## Not covered

Data written before this format does not open; Xenode has no production data,
so there is no reader for it. Descriptions, links, share bundle names and
access-request notes are still plaintext fields (F25).

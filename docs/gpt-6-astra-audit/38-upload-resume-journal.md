# Sealed Drive upload resume journal

This contract closes F17. Drive persists only ciphertext in its resume journal;
Photos continues using its existing memory-only UploadEngine checkpoints.

## Key and format

The shared UploadEngine owns journal version 1 and the concrete resume adapter.
It seals its private payload with crypto-core's existing v2 CryptoEnvelope,
using the new `upload-journal` envelope type. A distinct HKDF
`upload-journal/v1` purpose key comes from the product/Space key and a
Space-bound salt. It is a non-extractable AES-256 CryptoKey held only in memory.
Personal keys are derived during the Accounts handoff; organization/team
keyrings derive one journal key per issued Space-key version.

AAD binds account, product, Space, job id, wrap kind, key version and checkpoint
revision. The sealed payload holds filename, MIME type, size, placement,
reservation/bucket/object identity, completed chunks, encrypted metadata,
file-key wraps and IVs, including `spaceKeyWrapIv` and optimized wrap fields.
Raw product/file keys, source File handles, signed URLs and caller extras are
never serialized.

IndexedDB rows expose only opaque job/scope identities, format/revision/time
headers and encrypted blobs. Bounded SHA-256 digests of ordered 4 MB ciphertext
parts are stored inside the authenticated payload. Changed/swapped local bytes
fail verification before a record can authorize networking. Metadata is bounded
to 8 MB; total persisted file/variant bytes are capped at 250 MB. Larger uploads
can continue in the live tab; their sealed byte-less records request re-upload
after reload.

## Checkpoint transactions and lifecycle

Crypto work runs outside IndexedDB transactions. A checkpoint decrypts its
current metadata, merges the completed index and seals a new revision, then
uses a Dexie read/write transaction to compare revision, ciphertext and scope
before replacing the row. Conflicts retry; deletion remains deletion. Concurrent
workers/tabs cannot lose each other's checkpoints or recreate a cancelled job.

New jobs capture their account, Space, key version, metadata key and wrap target.
API calls carry the explicit Space and host session credentials. Vault lock,
account/Space changes and key changes abort requests and wake parked workers;
stale responses cannot publish, persist or finalize under a replacement context.
Labels are rendered only for the unlocked selected account/Space. Retry of a
live File uses a fresh job identity.

After reload, only the selected account/Space's sealed headers are read. Matching
keys must be available before opening the payload or starting a resume. The
record retains its original wrap version/IV and reservation identity. A pending
upload made under a superseded Space version requires re-upload before new PUTs;
an already completed reservation can still take its idempotent completion path.
Resume work uses the shared engine's normal concurrency limit.

## Reservation status API

`GET /api/objects/upload-status?bucketId=<ObjectId>&sessionId=<ObjectId>&offset=0`
requires current `write` access. It resolves only a create reservation belonging
to that account, Space and bucket. There is no caller-selected key-prefix list
and no `fileId` fallback. Each request HEADs at most 128 exact claimed keys with
four concurrent operations.

The response contains `sessionId`, `bucketId`, `spaceId`, `fileId`,
`completed`, `objects: [{ key, size }]` and nullable `nextOffset`. A completed
reservation must still reference its active Drive object and returns no HEADs.
Missing objects are absent only for a genuine provider 404; provider failures
return 502 instead of reporting absence.

- 400: malformed required identities or offset.
- 403: insufficient Space mutation permission.
- 404: inaccessible bucket/create reservation.
- 409: expired, cleaning/blocked, invalid manifest or unavailable completed object.
- 502: physical status could not be verified.

Resume checks the identity on every status/presign response, uses server
observations rather than local completion hints, and checks existing ciphertext
lengths against its immutable layout. It PUTs byte-identical ciphertext only to
the reserved keys, keeps `If-None-Match: *`, and never treats an occupied-key
failure as permission to overwrite. Finalization carries the complete original
crypto context and validates the returned object identity before updating the
local cache. Thumbnail ciphertext is retained so a missing claimed thumbnail
can be uploaded again. No Next route proxies file bytes.

## Development reset and verification limits

IndexedDB version 7 drops the obsolete plaintext `uploads` store and creates
`uploadJournal`. No old record is read, converted or re-encrypted. Old pending
server reservations remain owned by their cleanup ledger and signed-URL grace
period; clearing a local journal never deletes R2 bytes.

Tests use an in-memory IndexedDB implementation with real Dexie transactions,
disposable MongoDB and mocked R2/request transports. Real browser reload,
offline/lock/account-switch and live regional R2 journeys remain release checks.
Provider HEAD establishes presence/length; file-format AEAD still authenticates
content on download. IndexedDB eviction or user deletion may remove resumability.

# Drive upload finalization contract

Implemented in phase 0Q. This describes the generic direct-to-B2 Drive upload
path; dedicated organization routes and revision flows still need separate review.

## Presign and completion

- Presign returns the server-issued object key, bucket and Space-bound
  `sessionId`. Refresh and variant presign require the pending reservation.
- Completion sends that exact identity, encrypted name/key metadata and main
  ciphertext `size`. A chunked upload sends at most 4,096 ordered chunks with
  sequential indices, deterministic `{objectKey}-chunk-{index}` keys, positive
  safe-integer sizes and a matching JSON IV array. All non-final chunks have
  equal length; the final chunk is no larger. Their lengths sum to `size`.
- Every main/chunk/variant key must be reserved. The server HEADs every physical
  blob and checks its `ContentLength` against the supplied main/chunk size.
  Optimized/thumbnail lengths are always read from B2 and stored; an optional
  supplied variant size is an assertion that must match. A declared but missing
  variant prevents completion. Thumbnails in this contract are B2 ciphertext
  keys; the browser does not send inline thumbnail fallbacks to completion.
- B2 bytes are never proxied through the completion route. These HEAD checks
  establish lengths at verification time, not ciphertext authenticity or
  post-completion immutability. Previously issued PUT URLs still need a separate
  replay/immutability design.

## Database commit

The shared database repository uses a snapshot/majority transaction on a Mongo
replica set. No standalone or compensating-delete fallback exists. It claims
the exact pending reservation, inserts the Drive StorageObject, increments
quota and bucket counters and completes the reservation together.

The StorageObject ID equals the reservation ID. A personal Space's
`ownerAccountId` determines its Usage row; organization/team Spaces use their
`organizationId` and OrgUsage row. Quota must already be initialized, including
non-negative safe-integer bytes and a non-negative safe-integer limit or
`null` for unlimited storage. Completion does not create quota rows or change
plans. Current development setup uses the existing Drive usage initialization
and organization creation paths; synthetic tests seed those rows explicitly.
Disposable development records from earlier contracts can be reset/reseeded.

Metered bytes are the verified main/chunk ciphertext sum plus optimized and
thumbnail bytes. Manual/cron Bin purge and personal usage recalculation include
the same derivative bytes, as well as retained version bytes. Original-version
entries sharing current content are counted once. Personal recalculation counts
both Drive and Photos objects in the shared personal Space.

## Responses and races

- `201`: a new object committed.
- `200`: retry of the exact completed reservation returns its retained active
  Drive object without B2 reads or additional counters. Concurrent completion
  also converges to that object. A different object with the same key is not a
  completed retry.
- `400`: invalid metadata, sizes, chunk layout or IV count.
- `402`: quota rejects all verified physical bytes.
- `403`: foreign prefix or unclaimed physical key.
- `404`: missing bucket or required B2 blob.
- `409`: invalid reservation, B2 length mismatch, uninitialized quota, missing
  Space owner, or key/fingerprint conflict.

Quota, duplicate identity and missing-bucket failures roll back all database
writes and keep the reservation pending. Completion never deletes B2 blobs on
failure or returns another upload's fingerprint winner. An abandoned upload
remains a cleanup-ledger responsibility. Realtime publication happens after
commit and its failure does not turn durable completion into an error.

## Remaining boundaries

Drive orphan cleanup still needs a lease that serializes with completion and
reservation renewal, durable retry state and reconciliation of unused variants
on completed reservations. Bin purge also still needs durable transactional
metadata/accounting after confirmed B2 deletion. Revision and dedicated
organization upload routes are not covered by this generic route's transaction.
Browser journal Space/crypto completeness, opaque folder-free keys and B2 PUT
replay protection remain pending audit work.

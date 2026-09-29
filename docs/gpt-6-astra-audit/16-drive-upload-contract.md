# Drive upload finalization contract

Implemented in phases 0Q–0S. Personal, organization and team uploads use one
direct-to-B2 Drive path; revision flows still need separate review.

## Presign and completion

Use `/api/objects/presign-upload`, `presign-upload-multipart` and
`complete-upload`, selecting the Space with `x-xenode-space-id` or
`?spaceId=...`. The four separate organization/team presign/completion routes
were removed in 0S, along with the unused `/api/objects/[id]/complete-update`
endpoint that accepted an unverified size without charging Usage. No
compatibility alias remains. Browser callers already use
the canonical routes, and organization/team integration tests now do too.

Both presign paths perform a read-only quota preflight against the same Space
owner used by transactional completion. An organization member's personal
quota/subscription fields do not control organization uploads. Missing quota
state returns 409; exhausted headroom returns 402 before signing. Presign does
not expire plans or initialize limits. Billing's canonical writer owns plan
transitions. Presign responses include the resolved Space identity.

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

Phase 0R adds conditional five-minute cleanup leases that serialize with
completion and reservation renewal on the manifest. The authenticated HTTP cron
processes at most 100 eligible manifests per request after their 24-hour grace
window. Variant presign renews that window as well as main/chunk refresh.

Expired pending manifests transition to `cleaning`. Exact-key deletion is
reference-checked across all products, Bin and retained versions. Confirmed B2
deletion precedes ledger removal; transport/per-key errors retain retry state,
and interrupted leases become eligible after expiry. Failed work has a one-minute
cooldown. Only the current lease owner can retire or update a manifest.
Referenced or invalid manifests become `blocked` and retain their claims.

Completion stores `committedKeys` in its transaction. After grace, cleanup may
delete only reserved keys outside that set. It keeps the completed manifest and
all its key claims, marks its cleanup state `done`, and leaves object metadata,
usage and retries intact. Referenced unused keys block reconciliation; they are
not automatically discarded. The repository-root Vercel configuration requests
hourly cleanup; this is configuration, not proof of an active deployment.

Bin purge still needs durable transactional metadata/accounting after confirmed
B2 deletion. Revision routes are not covered by this upload transaction.
Browser journal Space/crypto completeness, opaque folder-free keys and B2 PUT
replay protection remain pending audit work.

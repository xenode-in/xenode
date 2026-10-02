# Photos upload contract

This is the development contract introduced by remediation phase 0N. There is
no legacy request fallback. File bytes are encrypted in the browser and sent
directly to R2 through its S3-compatible API; API routes handle identities,
manifests and metadata only.

## Presign

`POST /api/photos/uploads/presign` requires a Photos ProductSession and resolves
write access to the account's personal Space.

The JSON request contains `assetId`, `fileSize` (encrypted original bytes),
`mediaType` (the original MIME type), and—for images—`optimizedSize` and
`thumbnailSize`. Original web uploads are bounded to 250 MiB plus the GCM tag;
derivatives are bounded to 25 MiB. The browser generates the asset ID before
starting the request.

The server reserves a `PhotoUpload` row before returning signed URLs. The
response contains `uploadId`, `bucketId`, `original`, and optional `optimized`
and `thumbnail` variants. Each variant contains `objectKey` and `uploadUrl`.
Keys are server-generated `users/{accountId}/{randomHex32}` values. Repeating
presign for the same pending asset and sizes returns the same upload ID and
variant keys and renews the 24-hour cleanup grace window. An incompatible,
expired or completed manifest returns 409.
All variant PUTs use the signed `If-None-Match: *` condition; browser clients
must send that header. See [23-r2-write-once-upload.md](23-r2-write-once-upload.md).

## Completion

`POST /api/photos/uploads/complete` requires `uploadId`, `assetId`, `bucketId`
and the encrypted variant metadata. It verifies account, Space, regional bucket,
media type, every key and every size against the reserved manifest. R2 HEAD
responses must confirm the exact encrypted byte counts.

The shared database repository claims the manifest inside one Mongo transaction.
That transaction creates the Photos-owned StorageObject and PhotoAsset, reserves
Usage bytes, updates bucket counters and marks the manifest `completed` together.
The StorageObject ID is the manifest's ID. A competing completion or abort cannot
commit the same pending upload. A completed-manifest retry returns its exact
existing asset without new R2 HEADs or duplicate metering. An asset ID belonging
to another object returns 409; there is no destructive compensation path.

## Abort

`POST /api/photos/uploads/abort` accepts only `{ "uploadId": "..." }` as deletion
authority. Caller-supplied object keys are ignored. The shared repository marks
the manifest `aborting` to fence completion and URL renewal. The response is
202 with `cancelled`, `cleanupPending` and `cleanupAfter`. Repeated cancellation
is idempotent. The abort route makes no R2 call; physical cleanup waits for the
manifest's outstanding signed-URL grace to expire.

Completed or currently completing manifests return 409. Cleanup later checks
references across all products and retained StorageObject states, deletes exact
variant keys, and confirms absence with HEAD before removing the ledger.

## State and durability

| State | Meaning |
| --- | --- |
| `pending` | URLs may be issued and completion or abort may claim the upload |
| `completing` | Internal transaction claim; no partial finalization is committed |
| `completed` | Metadata and counters were written; client abort is denied |
| `aborting` | Cancelled or expired; cleanup waits for URL expiry, owns a lease, or retries |
| `blocked` | A claimed key is referenced by stored content; automatic deletion stops |

The manifest has a 24-hour expiry and deliberately has no TTL index.
`GET /api/cron/cleanup-photo-uploads` requires `Authorization: Bearer CRON_SECRET`
and processes at most 100 eligible expired pending or aborting manifests per
invocation. Cleanup takes a five-minute lease, protects cross-product retained
references and retires a manifest only after R2 confirms deletion and HEAD
reports each exact key absent. Failed attempts retain their manifest and use a
one-minute retry cooldown. Live leases and cooldowns are excluded from the cron
selection. See [24-photos-abort-lifecycle.md](24-photos-abort-lifecycle.md).

The Photos deployment's `apps/photos/vercel.json` schedules the route hourly;
the deployment must use the Photos app as its root and configure `CRON_SECRET`.
No live scheduler invocation is part of local validation.

Automatic cleanup leaves `completing` and `completed` manifests alone. New
finalization uses snapshot reads, primary routing and majority commit through
the shared transaction helper. MongoDB must run as a replica set; there is no
standalone-database fallback. A transaction abort leaves the manifest pending
and its counters/metadata unchanged. Disposable development records from earlier
non-transactional code can be reset/reseeded rather than migrated.

R2 is outside the database transaction. Blocked cleanup records still require
review. Create-only PUTs prevent replacing an existing key, and cleanup waits
for URL expiry so a deleted key cannot be recreated by an outstanding URL.

Development uses the new `photoUploads` collection and its unique
`(spaceId, assetId)` index. Disposable databases can be reset/reseeded; no
production-data migration or old-client compatibility path is required.

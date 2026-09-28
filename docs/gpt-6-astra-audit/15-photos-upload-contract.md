# Photos upload contract

This is the development contract introduced by remediation phase 0N. There is
no legacy request fallback. File bytes are encrypted in the browser and sent
directly to B2; API routes handle identities, manifests and metadata only.

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

## Completion

`POST /api/photos/uploads/complete` requires `uploadId`, `assetId`, `bucketId`
and the encrypted variant metadata. It verifies account, Space, regional bucket,
media type, every key and every size against the reserved manifest. B2 HEAD
responses must confirm the exact encrypted byte counts.

The manifest is conditionally claimed from `pending` to `completing` before
quota or metadata writes. A competing completion or abort cannot acquire the
same pending upload. A completed asset retry returns the existing asset without
deleting alternate ciphertext. Success creates the Photos-owned StorageObject
and PhotoAsset, updates Usage and bucket counters, and marks the manifest
`completed`.

## Abort

`POST /api/photos/uploads/abort` accepts only `{ "uploadId": "..." }` as deletion
authority. Caller-supplied object keys are ignored. The server claims the
manifest as `aborting`, checks references across all products and retained
StorageObject states, and deletes only its exact reserved variant keys.

Completed or currently completing manifests return 409. A referenced key is
retained. Transport failures or per-key B2 deletion errors return 500 and leave
the manifest retryable in `aborting`; confirmed deletion marks it `aborted`.

## State and durability

| State | Meaning |
| --- | --- |
| `pending` | URLs may be issued and completion or abort may claim the upload |
| `completing` | One completion attempt owns database finalization |
| `completed` | Metadata and counters were written; client abort is denied |
| `aborting` | Exact-key deletion is in progress or must be retried |
| `aborted` | B2 reported no deletion failures |
| `blocked` | A claimed key is referenced by stored content; automatic deletion stops |

The manifest has a 24-hour expiry and deliberately has no TTL index.
`GET /api/cron/cleanup-photo-uploads` requires `Authorization: Bearer CRON_SECRET`
and processes at most 100 expired pending, aborting or aborted manifests per
invocation. Cleanup takes a five-minute lease, protects cross-product retained
references and retires a manifest only after B2 confirms deletion. Failed
deletions retain their manifest for retry. Aborted keys are checked again after
the grace window so an upload replay through a previously issued URL cannot
leave permanent orphaned ciphertext.

The Photos deployment's `apps/photos/vercel.json` schedules the route hourly;
the deployment must use the Photos app as its root and configure `CRON_SECRET`.
No live scheduler invocation is part of local validation.

Automatic cleanup leaves `completing` and `completed` manifests alone. The
current multi-record completion writes are not yet a single database
transaction, so interrupted completing and blocked records need a separate
reconciler. Issued PUT URLs remain usable until their expiry; completed-content
immutability is not claimed by this contract yet.

Development uses the new `photoUploads` collection and its unique
`(spaceId, assetId)` index. Disposable databases can be reset/reseeded; no
production-data migration or old-client compatibility path is required.

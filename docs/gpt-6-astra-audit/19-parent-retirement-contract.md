# Drive parent retirement contract

Team and organization deletion cannot remove a Space, key envelope, quota owner, or parent row while ciphertext or a replayable upload remains. Development data uses this contract directly; there is no compatibility path for the old bulk-deletion behavior.

## Team deletion

`DELETE /api/orgs/{orgId}/teams/{teamId}` requires an organization owner or admin. Its first transaction marks the team `purgeState: pending`, marks the team Space `deleted`, and bins active Drive objects. A repeated request resumes the same intent. The route processes one bounded batch immediately and returns `200` only if every object and unfinished upload session is gone and the team/Space/product keys/member rows were removed in a final transaction. Otherwise it returns `202` with `cleanupPending: true`. Team list and member operations hide or reject pending teams.

## Organization deletion and recovery

`DELETE /api/orgs/{orgId}` is owner-only. It atomically records `deletedAt`/`scheduledPurgeAt` and suspends every organization and team Space. Product access and share URL issuance require an active Space. The owner can restore during the 30-day window while no permanent retirement has begun; restoration reactivates suspended Spaces in the same transaction that clears the deletion markers. Once the window closes or the purge intent starts, restoration returns `409`.

The hourly authenticated `/api/cron/purge-orgs` route first commits an irreversible organization `purgeState: pending`, marks its teams pending and Spaces deleted, and bins active Drive objects. It also advances standalone pending team deletions. It performs at most 100 Space steps per request, each scanning at most 20 objects by default. Sweep timestamps prevent one large or blocked parent from monopolizing the selection. Pending versions wait for the version-cleanup cron. B2 failures leave purge manifests and charged bytes for retry; `failedObjects` makes the cron return `500`. A parent finalizer refuses to run while any child object, pending/blocked upload cleanup, or team remains.

Each object uses the [Bin purge contract](18-drive-bin-contract.md): exact keys, a conditional cleanup lease, cross-object reference checks, confirmed B2 deletion, then one transaction retiring metadata and Usage/OrgUsage plus bucket counters. The latest UploadSession expiry guards against stale signed PUT replay. A missing bucket, foreign-product object, missing accounting state, or unresolved reference blocks cleanup rather than silently removing the parent. Folder children are selected independently for parent retirement so a directory with more than 100 descendants cannot stall the entire sweep.

Signed PUT reservation and renewal now increment a Space fence counter in the same transaction as the upload ledger. Create-upload and revision commits increment it in their accounting transaction. Team creation writes the organization and creates its row, membership, Space, and initial key envelope in one transaction. Concurrent Space suspension/deletion therefore conflicts with child writes: no new team, ledger, or file can commit after a parent finalizer has observed an empty Space. Finalizers retain unresolved `pending`, `completing`, `cleaning`, and `blocked` ledgers; reconciled completed ledgers are removed with the parent. The final transaction also removes empty photo albums and their share links; per-object purge removes file comments.

No live B2 deletion or deployed cron was exercised during this phase. A disposable development database should be reset and reseeded if it contains rows created by the retired bulk-deletion path.

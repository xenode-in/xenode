# Drive offline sync and scoped caches

F20 replaces timestamp-only sync with a commit-ordered tuple and durable
removal records. Realtime remains an invalidation hint; sync does not depend on
Redis delivery.

## Transactional ordering

`Space.driveSyncVersion` is a nonnegative safe integer. Every cache-visible
Drive mutation allocates a version by writing its Space inside the same Mongo
transaction as its object changes. Concurrent transactions conflict/retry on
that write; readers cannot observe a version before its changes commit.
Wall-clock timestamps do not order sync.

Uploads, folder creation/move, Bin/restore, revisions/version restore,
metadata edits, reordering and retirement stamp affected records with
`syncVersion`. A batch may give many records one version, so pagination sorts
by `(syncVersion, objectId)`. Sidecars and Photos records are excluded from this
Drive cache. File-open telemetry and baseline-history bookkeeping no longer
change the current content's `updatedAt`.

Final Bin purge writes an opaque `DriveSyncTombstone` in the transaction that
removes object metadata and retires accounting, after confirmed ciphertext
deletion. Tombstones contain only object id, Space, version and deletion time.
They have no TTL and remain available to long-offline clients. Retired object
ids cannot be reused for a folder/new upload; old cache entries cannot be
resurrected as a new object under that identity.

## API and cursor

`GET /api/files/sync?cursor=<opaque>&limit=500` resolves the current account and
requested Space with the normal ProductSession/Space access policy. Browser
callers send the exact `x-xenode-space-id`. The old `lastSync` parameter is
refused.

The version-1 cursor encodes account, Space, snapshot/delta mode, an inclusive
version watermark and the last tuple. Its scope/shape/range are validated
before reads; data queries always use the authorized Space and Drive product.
It is a continuation token, not an authorization credential.

No cursor starts a scoped initial snapshot with `reset: true`. A page series
pins its watermark; changes made during pagination are handled by the next
delta, even if an updated current row disappears from the pinned page range.
After the last page the cursor advances to the watermark. Each read uses a
snapshot transaction, merges current rows and retained removals, and returns at
most 1,000 entries (default 500).

Responses contain `accountId`, `spaceId`, `cursor`, `reset`, `hasMore` and
`changes: [{ objectId, syncVersion, type, object? }]`. `remove` covers Bin,
pending purge and hard deletion; `upsert` carries an allowlisted encrypted
listing snapshot with complete workspace key/variant context. Raw file keys,
version history, signed URLs and plaintext names are not projected.

Malformed/foreign cursors and limits return 400. Invalid/decreasing development
sync state or unavailable Spaces return 409 with a reset/unavailable code.
Unexpected read failures return 503, not an empty successful page. Responses
are no-store.

## Browser state

IndexedDB remains account-owned; cursor and removal state are additionally
partitioned by Space. Applying a page and saving its cursor is one Dexie
read/write transaction. It compares the previously requested cursor with the
stored cursor, preventing an older tab/page from advancing state. A scope/lock
change before commit aborts application. Initial reset clears only that Space.

Local removal guards retain the latest version for each removed id. An old
listing/upload callback cannot overwrite newer state or resurrect a removed
row. Restore arrives with a newer version and can replace the guard.

Decrypted search indexes are memory-only and partitioned by account/Space.
Only the selected unlocked scope is indexed, with each record's exact metadata
key version. Lock/scope change clears the old index and aborts stale network or
decryption work. Cache and dashboard reads are Space-filtered; query keys
include account identity. No global localStorage timestamp is used.

## Disposable development reset

Fresh mutations populate versions normally. No server data backfill, migration
or rollback job is provided. Reset obsolete development records lacking sync
versions together with their Space counters/tombstones; never repair versions
or purge removal records independently. The empty-storage seed refuses retained
sync tombstones too.

IndexedDB version 8 clears the obsolete file cache, drops its unused plaintext
metadata cache and creates scoped cursor/removal stores. Upload journals and
encrypted editor drafts are retained. Logout clears the account database and
its memory indexes.

Mongo/Dexie tests verify equal-version ties, changing pages, clock regressions,
uncommitted/rolled-back changes, purge retention, scope rejection, atomic cursor
application and stale response/listing protection. Real multi-browser offline,
revocation and deployed sync/realtime journeys remain release checks.

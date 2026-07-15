# Android Performance and Realtime Architecture Audit

Date: June 20, 2026

## Outcome

The first high-impact production slice is implemented:

- Next.js and Socket.IO share one HTTP server.
- Socket authentication uses a five-minute, HMAC-signed token issued only
  after the existing Better Auth session is verified.
- Every connection joins `user:{userId}`.
- Redis pub/sub distributes typed storage events across all Next.js replicas.
- Storage mutations invalidate versioned Redis folder caches and broadcast
  events without making Redis availability a correctness dependency.
- Android opens a folder from an account-scoped SQLite cache, revalidates in
  the background, and refreshes only folders affected by realtime events.
- Folder requests fetch direct children with cursor pagination instead of
  downloading and decrypting the entire bucket.
- Storage usage responses use a short Redis cache and are invalidated by
  upload mutations.

This removes the dominant Android folder-navigation bottleneck and establishes
the synchronization spine required for the remaining offline-first work.

## Measured/code-evidenced bottlenecks

### P0: every folder focus downloaded the whole bucket

The old drive screen called `listAllObjects(bucketId)` with a forced refresh on
every focus. That issued one request per 100 objects until the complete bucket
was downloaded, decrypted every encrypted filename, and only then filtered the
current folder on-device.

At 10,000 objects this means roughly 100 sequential API calls before the
current folder is authoritative. It also defeats the existing in-memory SWR
cache because focus always forced a refresh.

Implemented fix:

- `GET /api/objects?bucketId=...&prefix=...&limit=100`
- MongoDB returns only direct children using the existing `{ bucketId, key }`
  index.
- Cursor pagination drives FlashList `onEndReached`.
- Android SQLite renders cached folder rows before networking.

### P0: no cross-device invalidation

Web and Android mutations only updated local state. Other devices had no
signal, so users needed navigation or pull-to-refresh.

Implemented fix:

1. Mutation commits to MongoDB/B2.
2. Relevant Redis folder-version keys are incremented.
3. A typed event is published to `xenode:sync:events`.
4. Every Next.js Socket.IO replica receives the event.
5. The local `user:{userId}` room receives `sync:event`.
6. Android invalidates only the affected SQLite folder and silently reloads it.

### P1: cache was memory-only

`ResourceCache` deduplicated requests during one process lifetime but could not
make a cold app launch or app restart instant.

Implemented fix:

- Folder listings are persisted in `xenode-drive-cache.db`.
- Cache rows are isolated by `accountId`, `bucketId`, and `prefix`.
- SQLite uses WAL and `synchronous=NORMAL`.
- Fresh rows have a 30-second SWR window; realtime events invalidate them
  immediately.

### P1: storage usage recalculated on every request

`/api/usage` recalculated totals and then ran a second aggregation for category
breakdown on every call.

Implemented fix:

- `storage:{userId}` caches the normalized response for 30 seconds.
- Upload mutations delete the key.

### P1: folder derivation contained an O(n²) lookup

The drive screen scanned `objects` and then called `objects.find` for each
folder. It now builds one key map and performs O(1) folder lookups.

### Existing strengths retained

- FlashList is already used for the Android drive.
- `expo-image` is already the correct image stack for this Expo application.
- Thumbnail URLs are pre-signed in list responses, avoiding one API call per
  thumbnail.
- Gallery v2 already has disk caching, lazy cloud metadata, batched viewport
  hydration, and a thumbnail generation queue.
- Photo backup already uses SQLite for synced assets and has a persisted queue,
  retries, background execution, and account scoping.

## Realtime event contract

Supported event names:

- `FILE_CREATED`
- `FILE_UPDATED`
- `FILE_DELETED`
- `FOLDER_CREATED`
- `FOLDER_UPDATED`
- `FOLDER_DELETED`
- `FILE_MOVED`
- `FILE_STARRED`
- `FILE_UNSTARRED`
- `PHOTO_SYNC_COMPLETED`
- `TRASH_UPDATED`
- `STORAGE_UPDATED`
- `SYNC_REQUIRED`

Envelope:

```ts
interface SyncEventEnvelope {
  id: string;
  type: SyncEventType;
  userId: string;
  occurredAt: string;
  payload: {
    bucketId?: string;
    objectId?: string;
    objectIds?: string[];
    key?: string;
    keys?: string[];
    parentPrefix?: string;
    affectedPrefixes?: string[];
    destinationPrefix?: string;
    object?: StorageObject;
    objects?: StorageObject[];
  };
}
```

Event IDs permit future client-side deduplication and replay cursors.

## Redis design

Implemented keys:

```text
xenode:sync:events
folder-version:{userId}:{bucketId}:{prefix}
folder:{userId}:{bucketId}:{base64url(prefix)}:v{version}:{sort}:{dir}:{limit}
storage:{userId}
recent:{userId}
```

The folder cache uses versioned invalidation:

- Reads fetch the current version and include it in the response-cache key.
- Mutations increment versions for affected source/destination folders.
- Old response values expire naturally and do not require Redis `SCAN`.

Recommended next keys:

```text
recent:{userId}:v{version}
upload:{userId}:{uploadId}
sync-seq:{userId}
sync-replay:{userId}
```

`sync-seq` and `sync-replay` should be added when guaranteed catch-up after a
long disconnect is implemented.

## Android local storage decision

Use SQLite plus SecureStore; do not add MMKV yet.

- SQLite: folder/file rows, pagination state, favorites, recent items,
  storage snapshot, operation journal, upload queue, conflict metadata.
- SecureStore: authentication cookies and cryptographic secrets only.
- AsyncStorage: tiny bounded preferences such as view mode.
- `expo-image`: decoded memory cache and disk image cache.

MMKV is excellent for small synchronous values, but it does not solve indexed
10,000-row listings, transactional offline operations, or queue queries.
Adding it now would introduce a second general-purpose cache without removing
SQLite.

Implemented SQLite table:

```sql
CREATE TABLE folder_cache (
  accountId    TEXT NOT NULL,
  bucketId     TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  itemsJson    TEXT NOT NULL,
  nextCursor   TEXT,
  hasNextPage  INTEGER NOT NULL DEFAULT 0,
  fetchedAt    INTEGER NOT NULL,
  PRIMARY KEY (accountId, bucketId, prefix)
);
```

Recommended normalized v2 schema:

```sql
objects(
  account_id, object_id, bucket_id, key, parent_prefix, encrypted_name,
  content_type, size, starred, deleted_at, server_version, updated_at,
  payload_json, PRIMARY KEY(account_id, object_id)
)

folder_pages(
  account_id, bucket_id, prefix, cursor, next_cursor, fetched_at,
  PRIMARY KEY(account_id, bucket_id, prefix, cursor)
)

pending_ops(
  op_id PRIMARY KEY, account_id, entity_id, kind, base_version,
  payload_json, created_at, retry_count, state
)

uploads(
  upload_id PRIMARY KEY, account_id, local_uri, destination_prefix,
  bytes_total, bytes_uploaded, multipart_state_json, retry_count, state
)
```

Normalize `itemsJson` after the realtime foundation is proven in production.
The current row-per-folder format minimizes migration risk and already removes
the network wait from folder opening.

## Thumbnail strategy

Choose `expo-image`, which is already installed and integrated.

- Memory/disk cache: `expo-image` with stable cache keys based on object ID plus
  thumbnail version.
- List response: continue attaching signed thumbnail and optimized URLs.
- Progressive display: encrypted thumbnail, then optimized 1600px asset, then
  original only when zoom requires it.
- Prefetch: next 1–2 viewport windows after scroll settles.
- Invalidation: object ID plus `updatedAt` or explicit thumbnail version;
  never invalidate because a signed URL rotated.
- Avoid base64 image payloads in React state.

Do not add `react-native-fast-image`; it duplicates an already capable,
Expo-supported native image pipeline.

## TanStack Query decision

Do not make TanStack Query the persistent database.

Recommended rollout:

- Add it for server-state orchestration, mutation dedupe, retries, and
  optimistic lifecycle hooks.
- Keep SQLite as the durable source for instant folder rendering.
- Query keys:

```text
["folder", accountId, bucketId, prefix]
["object", accountId, objectId]
["storage", accountId]
["recent", accountId]
["starred", accountId]
```

- Query functions read SQLite first and revalidate the API.
- Realtime events patch/invalidate exact keys.
- Persist only bounded query metadata if Query persistence is enabled; do not
  duplicate thousands of full rows in both Query persistence and SQLite.

## Offline-first operation model

Each local mutation should be one SQLite transaction:

1. Write the optimistic object state.
2. Append a `pending_ops` row with an idempotency key and base server version.
3. Render immediately.
4. Sync in creation order when online.
5. Replace the optimistic version with the server result.
6. Remove the journal row.

Server mutation APIs need:

- `Idempotency-Key`
- `baseVersion`
- monotonic `version` on each object
- tombstones for deletes
- batch sync endpoint returning accepted operations, conflicts, and the newest
  user sync sequence

## Conflict resolution

Use deterministic server arbitration with preserved user intent:

- Rename vs rename: if base versions match, accept. Otherwise latest accepted
  server operation wins and the losing name is surfaced as a conflict copy or
  explicit resolution prompt. Never silently discard both names.
- Delete vs modify: delete tombstone wins. Retain the modify operation in
  conflict history so the client can offer restore-as-copy.
- Move vs delete: delete wins. A move against a tombstone is rejected as
  `ENTITY_DELETED`.
- Move vs move: latest accepted server version wins; reject cycles and moving a
  folder into itself.
- Star/unstar: last-write-wins is acceptable because it is reversible and does
  not destroy content.

Every operation must be idempotent and ordered by a server-issued per-user
sequence, not device wall-clock time.

## Upload manager

Photo backup already has much of the required machinery. General drive uploads
still run in the screen and do not survive process death.

Next implementation:

- Move drive upload work into the existing queue/worker architecture.
- Persist encryption completion, multipart upload ID, uploaded part ETags,
  retries, and destination prefix.
- Keep temporary encrypted chunks in app-owned storage until completion.
- Retry with exponential backoff plus jitter.
- Re-presign only expired parts.
- Finalization is idempotent by upload ID/content fingerprint.
- Android background execution should use the existing task integration and
  foreground-service notification for long user-initiated uploads.

## Large-folder rendering

Implemented:

- Direct-child API.
- 100-row cursor pages.
- FlashList incremental loading.
- O(n) directory mapping.

Next:

- Move filtering by type and date sorting to the API.
- For encrypted name sorting, maintain an optional device-local normalized
  sort key after decryption.
- Store normalized object rows instead of folder JSON for indexed local sort.
- Add list performance telemetry: JS frame drops, UI frame drops, render count,
  page fetch duration, decrypt duration.

## Performance targets and instrumentation

Targets:

```text
Cached folder first paint      p95 < 100 ms
Network folder first page      p95 < 500 ms
Cached thumbnail display       p95 < 50 ms
Cross-device propagation       p95 < 500 ms
Warm app interactive           p95 < 2 s
Scroll                         >= 60 FPS on target midrange Android device
```

Record:

- `folder_cache_read_ms`
- `folder_decrypt_ms`
- `folder_network_ms`
- `folder_first_paint_ms`
- `socket_event_lag_ms = receivedAt - occurredAt`
- `socket_reconnect_count`
- `folder_cache_hit`
- API `x-xenode-cache`
- FlashList blank-area/frame metrics

Do not claim the target is achieved until p50/p95/p99 values are collected on
a release Android build and a production-like dataset.

## Deployment requirements

Socket.IO is hosted by `server.mjs` beside Next.js on port 3000. Required:

```text
REDIS_URL
BETTER_AUTH_SECRET
REALTIME_TICKET_SECRET (mandatory, at least 32 bytes, distinct)
CDN_SIGNING_SECRET (mandatory, at least 32 bytes, distinct)
REALTIME_ALLOWED_ORIGIN (mandatory comma-separated exact web origins)
```

The Socket.IO path is `/api/socket.io`.

This deployment requires the Docker/custom Node server. Vercel serverless
functions do not provide a persistent WebSocket server. If the web app remains
on Vercel, realtime must be deployed by moving the same Next.js application to
the provided container/runtime; creating a separate socket service would
violate the selected architecture.

## Ordered roadmap

1. Ship the implemented folder-scoped SQLite cache and realtime invalidation
   behind a server/mobile feature flag.
2. Add production timing telemetry and validate cache-hit and event-lag p95.
3. Emit events from remaining restore/purge/copy/update-content paths and add a
   monotonic per-user sync sequence plus reconnect catch-up.
4. Normalize the SQLite object store and migrate favorites/recent/storage into
   it.
5. Move general drive uploads into the persisted worker queue.
6. Add the offline operation journal and idempotent/versioned mutation APIs.
7. Introduce TanStack Query as orchestration over SQLite, not as the database.
8. Add viewport thumbnail prefetch and versioned cache keys.
9. Load-test 10k direct children, 100k total objects, multi-device mutation
   bursts, Redis reconnects, and Socket.IO replica fan-out.
10. Remove pull-to-refresh as a required recovery path after sequence catch-up
    proves reliable; it may remain as a user-controlled diagnostic action.

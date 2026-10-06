# Photos asset lifecycle and API origin contract

Photos assets are created only by Photos upload completion. The personal library
owns its asset IDs and their Photos storage objects; an asset cannot relabel a
Drive object. Mutation batches contain 1–100 unique asset IDs and resolve the
caller’s Photos Space/action before accessing records.

- `POST /api/photos/assets/trash` marks PhotoAsset and StorageObject together.
  It fences the active Space, verifies exact product/Space ownership, preserves
  keys and quota. Repeating trash is a no-op.
- `POST /api/photos/assets/restore` restores both records transactionally.
  Once permanent purge is queued, restore fails with 409, including blocked
  cleanup. Restore does not reconstruct broken/missing storage records.
- `GET /api/photos/trash` uses bounded `(trashedAt, assetId)` pagination.
- `POST /api/photos/assets/purge` records an immutable purge intent and returns
  202. It does not immediately discard metadata or quota.
- `GET /api/cron/purge-photo-trash` requires the scheduler bearer secret. It
  queues trash older than 30 days and processes at most 100 pending manifests.
  The hourly schedule is in Photos’ existing shared Vercel/Docker contract.

The shared storage purge engine handles exact keys, retained references across
products, leases, retries, signed-PUT grace and transactional accounting for
both Drive and Photos. Drive entry points fix `productId=drive`. Photos cleanup
waits for its upload manifest’s expiry, deletes every original/derivative,
confirms absence with HEAD, and only then removes asset/album references and
retires bytes/objects. It does not create a Drive sync tombstone. Photos has no
share links yet; when sharing ships, trashed and purged assets must stop
resolving through it. No TTL index
or migration is introduced. Bucket routing comes from validated stored bucket
metadata, so an absent account profile cannot silently route cleanup to Asia.

Photos now applies `isCrossOriginProductRequest` from identity-core to every
API through its proxy; lifecycle routes also enforce it directly. It rejects
foreign/opaque Origins and same-site/cross-site browser requests, including
simple text/plain forms. Exact Photos-origin browser requests and headerless
native/scheduler requests proceed to their normal credential checks. Drive
uses the same helper for its main API boundary. Host-only cookies alone do not
prevent a sibling origin from causing an authenticated browser request.

A real headless-browser test uses two loopback-mapped sibling test domains.
The hostile form sends a host-only SameSite=Lax cookie and valid JSON, but the
origin guard returns 403 and leaves the synthetic mutation counter unchanged.
No user browser, real account or cloud object is used.

Local tests cover idempotency, role/Space/product rejection, restore/purge
races, outstanding PUTs, provider/HEAD failures, cross-product references,
album/accounting retirement, cursor ties and cron authentication. Parent
retirement integration, sharing and media metadata follow in later increments.
Deployment, real R2 and live scheduler verification are owned by the user and
remain release checks.

## Browsing and the web app

- `GET /api/photos/timeline`, `GET /api/photos/trash` and
  `GET /api/photos/albums/{albumId}` return cursor pages (at most 200). An album
  page is an offset into the album's member list, in album order, with trashed
  and other-Space members skipped. `GET /api/photos/albums` returns newest-first
  summaries with a member count and a cover id (explicit, else the first
  member), never the member list. Malformed cursors and limits return 400.
- Asset content is served for active assets. `?state=trashed` serves a trashed
  asset's encrypted previews to its owner until permanent deletion is requested.
- The web app renders the timeline, albums and trash through one
  window-virtualized grid that loads pages as its end comes into view. Photos
  offers Move to trash; Trash offers Restore and, after confirmation, Delete
  forever. Actions are sent in batches of at most 100 assets.
- The search box filters the photos loaded so far by date or photo/video, and
  offers to search older photos when nothing matches. Sharing, Help and Settings
  are not offered until they have real flows.

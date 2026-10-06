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
retirement integration and the Photos UI/sharing/media work follow in later
coding increments. Deployment, real R2 and live scheduler verification are
owned by the user and remain release checks.

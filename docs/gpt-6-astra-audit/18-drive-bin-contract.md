# Durable Drive Bin deletion

Permanent deletion first writes an embedded purge manifest on each binned
Drive object. The snapshot contains exact current/chunk/derivative/version
keys, physical bytes, the authoritative quota owner and a deletion deadline.
The marker increments the document version key and is irreversible: Bin restore
is rejected even if a storage delete fails or cleanup has not begun.

The shared restore and purge-intent repositories use snapshot/majority Mongo
transactions. Restore rechecks all selected objects, folder descendants and
sidecars in the requested Space/bucket. A conflicting purge intent prevents the
whole restore selection. Generic application updates/deletes and stale
hydrated saves cannot alter a marked object; bulk reorder also excludes it.

A purge worker takes a five-minute conditional lease. It checks references
across every product and retained state, validates regional bucket routing and
deletes exact keys. References elsewhere quarantine the manifest as blocked.
After B2 confirms every requested deletion, one transaction removes object and
share/album metadata, decrements owner Usage/OrgUsage and regional bucket bytes
and object counts. Failed storage or accounting keeps the manifest, references
and charged bytes, with a one-minute retry deadline. Only the current lease
owner can retire it.

The manifest waits until all recorded upload grace windows for its keys expire,
including retained revisions. This conservatively uses UploadSession expiry
(currently 24 hours), so recent permanent-deletion requests can return 202 until
cleanup is eligible. This covers deletion replay windows; it does not make
active completed objects immutable against an already-issued PUT URL.

Manual and cron paths share the repository. Each request handles at most 100
objects. Browser actions split selected IDs into bounded requests; Empty Bin
continues while new eligible records remain. Queued items leave the ordinary
Bin listing and cannot be restored. The cron retries queued work and queues
30-day-expired items; a folder does not shorten a child's own retention period.
Pending version deletion must complete first to prevent overlapping byte
decrements. Organization endpoint adapters resolve their URL's Space through
the same authorization boundary.

No TTL index is added and no disposable-data migration is supplied. This
phase does not fully replace organization/team retirement or album-share
thumbnail cleanup: those lifecycles still require their own durable design.
No live B2 delete or deployed scheduler was exercised.

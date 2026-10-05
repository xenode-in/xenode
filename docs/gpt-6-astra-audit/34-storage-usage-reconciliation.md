# Storage usage reconciliation

`@xenode/database` owns `getStorageUsageReconciliation({ type, id })` for a
personal account or organization. This is a read-only metadata report, not an
R2 inventory or counter-repair operation. It never writes usage, plan state or
storage records and never calls a storage provider.

## Snapshot and accounting

One MongoDB snapshot transaction reads the owning Spaces, the recorded Usage
or OrgUsage counters and a bounded cursor over their storage objects. An
organization includes all of its organization and team Spaces regardless of
status. Closed Spaces and Bin/pending-purge objects remain charged until the
purge transaction retires their metadata. Upload reservations are excluded:
their bytes become charged only when completion commits a storage object.

The reader projects only product identity and numeric byte-summary fields. It
uses `storageObjectTotalBytes`, the same definition used by version/Bin
retirement: current size plus thumbnail/optimized size, plus retained version
bytes; chunked versions use the sum of chunk sizes; original snapshots sharing
current content count no additional bytes. Pending/blocked version deletions
remain charged. Zero-byte folder records and sidecars count as objects.
Absent/null optional derivative, history and chunk fields mean no additional
bytes, matching the current upload builders and the shared byte helper. Required
current and retained byte sizes must still be valid non-negative safe integers.

The personal totals reader delegates to this shared implementation; there is
no separate app aggregation formula or Photos-excluding model query.

## Operator endpoint

`GET /api/admin/storage-reconciliation?orgId=<id>` requires a current Drive Admin
session. User credentials do not authorize it. Responses are `no-store` and
contain only owner identity, timestamp, Space count, recorded/computed totals,
their difference, and validation status. No object IDs, names, keys, envelopes
or plan fields are returned. The API contract is in Drive's OpenAPI document.

`difference = computed - recorded`: a positive byte difference means the
counter understates retained metadata. A report does not overwrite counters
maintained by concurrent transactions, even when it finds a difference.

| Status | Meaning |
| --- | --- |
| `matched` | Both counters agree with the snapshot |
| `drift` | The counters differ; the difference is available for investigation |
| `missing_usage` | No recorded counter row exists; no row is created |
| `invalid_data` | An unknown product, malformed byte field/counter or unsafe sum prevents a valid comparison |
| `scan_limit` | More than 100,000 objects would be scanned; truncated totals are never reported as valid |

Invalid source metadata and incomplete scans return `computed: null` and no
difference. Invalid recorded counters return `recorded: null` and no difference.
A database/snapshot failure returns 503, never a zero or matched report.

This report cannot establish whether R2 contains unreferenced ciphertext or
whether stored byte metadata matches live provider HEAD results. Those remain
storage release/operational checks. Disposable development data can be reset
using the existing reset path; no backfill or automatic repair is introduced.

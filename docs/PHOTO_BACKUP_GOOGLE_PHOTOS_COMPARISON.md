# Xenode Photo Backup Reliability Comparison

Date: 2026-06-15

## Comparison boundary

This comparison uses Google Photos as a user-visible reliability benchmark. It
does not claim knowledge of Google Photos' internal architecture. Editing,
memories, sharing, search intelligence, and other non-backup product features
are outside this audit.

| Capability | Xenode status | Evidence and gap |
| --- | --- | --- |
| Full-library backup | Present | Empty album selection scans the full photo library |
| Selected-folder backup | Present | Backup settings persist selected album IDs |
| Automatic new-capture backup | Present, needs validation | Live MediaLibrary observer prepends new assets |
| Manual single-photo backup | Present | Photos experience can start foreground backup |
| Persistent automatic-backup preference | Present | Running/paused user intent persists across launches |
| Active progress | Present | In-app progress, gallery overlays, and system notification |
| Pause/resume/cancel | Present | Pause/resume in UI and notification; cancel in notification |
| Process-death recovery | Present, needs validation | Persisted queue plus launch/background resume paths |
| Reboot/background safety net | Present, needs validation | WorkManager task and boot/background permissions |
| Duplicate prevention | Strong, needs device validation | Local ID, metadata HMAC, content HMAC, tested atomic backend race guard |
| Account isolation | Strong, needs tests | Owner-bound keys/config and centralized logout cleanup |
| Failure retries | Partial | Persistent exponential retry, but mostly generic classification |
| Terminal failure recovery | Present | Durable failures expose reasons, retry-all, targeted retry, and remove controls |
| Backup health/history | Partial | Last successful backup and unresolved counts are visible; no detailed history |
| Wi-Fi/cellular controls | Present | Account-scoped Wi-Fi-only policy blocks without consuming retries |
| Charging/battery controls | Missing | OEM guidance exists, but no charging-only or threshold policy |
| Low-storage behavior | Present, needs device validation | Conservative free-space preflight blocks before variant generation |
| Quota recovery guidance | Partial/unverified | Backend enforces quota; backup-specific actionable UX is unverified |
| OEM reliability evidence | Missing | Guidance exists; representative-device results are not documented |

## Already competitive foundations

- Xenode backs up encrypted variants and metadata while preserving the existing
  E2EE contract.
- The queue is persistent, concurrency is bounded, and retries survive launches.
- New captures can jump ahead of the historical backlog.
- Deduplication includes a backend race guard, which is important for reinstall
  and multi-device behavior.
- Paused backup remains paused across launches and background task invocations.

## Highest-impact parity gaps

1. **Backup health:** Expand the current last-success and unresolved-count
   status into clear blocked reasons and useful history.
2. **Resource policy:** Users need network and power controls suitable for large
   libraries.
3. **Device evidence:** Background reliability needs a documented Android/OEM
   test matrix rather than source-code intent alone.

## Out of scope

- Changing Xenode's cryptographic design or encrypted-object format.
- Reproducing Google Photos' editing, memories, sharing, or ML features.
- Inferring or copying undocumented Google Photos internals.

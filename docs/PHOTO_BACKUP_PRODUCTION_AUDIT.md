# Xenode Photo Backup Production Audit

Date: 2026-06-15

## Remediation progress

The following audit findings were remediated after the discovery pass:

- **PB-01 resolved in code:** unavailable media now becomes a durable
  non-retryable failure and is never finalized or recorded as synced.
- **PB-02 resolved in code:** terminal failures persist across launches,
  automatic workers do not revive them, and the backup modal exposes reasons,
  retry-all, per-item retry, and per-item removal.
- **PB-03 resolved in code:** `failedCount` now counts unique terminal failed
  photos rather than retry attempts.
- **PB-04 partially resolved:** focused backup-hardening regression tests now
  cover terminal retry semantics, unavailable-media guards, retry
  classification, account isolation, migration retry, 100k-item queue
  serialization, backend ownership, quota rollback, and deduplication races.
- **PB-O3 partially resolved:** permanent API 4xx errors, including quota
  exhaustion, stop retrying immediately; transient failures remain retryable.
- **PB-O4 resolved in code:** a failed legacy migration remains retryable on
  the next process launch.
- **Backend finalization hardened:** related upload keys must belong to the
  authenticated user's prefix; quota rejection rolls back new metadata and
  uploaded blobs; an atomic partial unique index closes concurrent active
  content-fingerprint races.
- **Quota accounting hardened:** quota increments are atomic across concurrent
  uploads. Existing-object size changes enforce quota before metadata mutation,
  adjust bytes without incrementing object/upload counts, and roll back byte
  accounting if metadata save fails.
- **Network policy partially hardened:** account-scoped Wi-Fi-only backup is
  enforced before start and between queue items. Offline/disallowed work waits
  without consuming retries, exposes a blocked reason, and rechecks on network
  changes.
- **Account-wide API failures hardened:** session expiry, quota exhaustion, and
  lost storage authorization block the queue once with an actionable reason;
  photos remain pending and do not each become terminal failures.
- **Foreground-service cleanup hardened:** immediate blocked/error outcomes now
  stop the initial foreground service notification instead of leaving stale
  background activity visible.
- **Local-storage handling hardened:** upload preparation checks free device
  storage before generating variants, and generated thumbnail/optimized files
  now join the guaranteed temporary-file cleanup path.

Verification completed without an Android build:

- Android TypeScript: passed.
- Focused Android lint: passed with pre-existing warnings only.
- Vitest focused photo-backup/finalization selection: 21 tests passed.
- Full existing Web Vitest suite: 52 tests passed.
- Android TypeScript and focused backup lint: passed with zero warnings.

## Executive assessment

The photo-backup system is substantially implemented and has strong foundations:
account-bound key loading, persistent queueing, foreground execution, a
WorkManager safety net, bounded upload concurrency, cleanup, and multi-tier
deduplication.

It is not yet production-ready as a whole. The confirmed queue-finalization
and terminal-recovery defects have been remediated. The principal remaining
release gates are broader failure-injection coverage, production deployment of
the deduplication index, and missing device evidence for background reliability.

| Subsystem | Classification | Reason |
| --- | --- | --- |
| Queue engine | Needs Hardening | Terminal semantics are hardened; device recovery and interruption evidence remain |
| Discovery engine | Needs Hardening | Full, incremental, album, and live discovery exist; device edge cases unverified |
| Background execution | Needs Hardening | FGS and WorkManager exist; OEM/runtime guarantees unverified |
| Retry system | Needs Hardening | Persistent backoff and terminal recovery exist; broader typed failure handling remains |
| Failure handling | Needs Hardening | Terminal, account-wide, network, and low-storage blockers exist; broader fault injection remains |
| Backup UI | Needs Hardening | Active progress, durable failures, and last-success health exist; detailed history is absent |
| Folder management | Needs Hardening | Full library and selected folders exist; permission/device testing is incomplete |
| Duplicate prevention | Needs Hardening | Atomic active-fingerprint race guard is tested; reinstall/device validation remains |
| Account isolation | Needs Hardening | Strong ownership checks; no automated account-switch proof |
| Recovery | Needs Hardening | Queue/process recovery exists; device validation is absent |
| Migration | Needs Hardening | Failed migration retries; runtime diagnostics and fault-injection evidence remain |
| Settings | Partially Implemented | Scope, Wi-Fi-only policy, and OEM guidance exist; power policies are absent |
| Automated testing | Partially Implemented | Focused cross-repo hardening tests exist; Android device/integration coverage remains |

## Confirmed findings

### PB-01: Unreadable or missing assets were finalized as successfully synced

- **Original behavior:** `_uploadItem()` marked iCloud-only, unresolvable, or
  missing assets as `skipped`, then returns normally. `_runOneItem()` interprets
  the normal return as success. `_finalizeItem()` overwrites the item to `done`
  and records its local asset ID in `SyncDb`.
- **Evidence:** `xenode-expo/src/sync/SyncEngine.ts:917`,
  `xenode-expo/src/sync/SyncEngine.ts:930`, and skip returns beginning at
  `xenode-expo/src/sync/SyncEngine.ts:1134`.
- **Reproducible scenario:** Queue an asset, remove it or make it unavailable
  before upload, run the queue, and inspect queue state plus `synced_assets`.
- **Impact:** A temporarily unavailable asset can be treated as backed up and
  excluded from later scans, causing a missed backup.
- **Confidence:** High. The result follows deterministically from control flow;
  a runtime regression test is still required.
- **Recommendation:** Return an explicit upload outcome (`uploaded`,
  `already-present`, `skipped-retryable`, `skipped-terminal`) and finalize each
  outcome without treating skipped assets as synced.
- **Migration/compatibility:** No encrypted-data migration. Existing false
  synced rows may need a conservative rescan/reconciliation strategy.
- **Remediation:** Unavailable assets now throw an explicit non-retryable sync
  error, remain durable failures, and are not recorded as synced.

### PB-02: Terminal failures had no durable user recovery path

- **Original behavior:** After five failures, `SyncQueue.markFailed()` changed an
  item to `skipped`. `SyncQueue.failed` includes only `failed` items. The engine
  therefore completes and clears a queue containing terminal skipped failures.
  The active UI removes non-retrying items and exposes no manual terminal retry.
- **Evidence:** `xenode-expo/src/sync/SyncQueue.ts:86`,
  `xenode-expo/src/sync/SyncEngine.ts:1085`,
  `xenode-expo/src/sync/syncOverlayStore.ts:45`, and
  `xenode-expo/src/components/sync/PreSyncModal.tsx:317`.
- **Reproducible scenario:** Force one item to fail five times, then inspect the
  final engine status, persisted queue, and available UI actions.
- **Impact:** Users cannot identify or recover photos that exhausted retries.
- **Confidence:** High.
- **Recommendation:** Preserve terminal failures in a durable account-scoped
  failure list and expose retry/remove/details controls.
- **Migration/compatibility:** No cloud-format change. Existing skipped failures
  already cleared from storage cannot be reconstructed reliably.
- **Remediation:** Terminal failures remain `failed`, survive relaunch, are
  excluded from automatic resume, and expose retry-all, targeted retry, reason,
  and remove controls.

### PB-03: Displayed failed count measured attempts, not failed photos

- **Original behavior:** `failedCount` incremented on every failed attempt,
  including attempts that will retry. The UI labels this value as
  "`N failed`".
- **Evidence:** `xenode-expo/src/sync/SyncEngine.ts:985` and
  `xenode-expo/src/components/sync/PreSyncModal.tsx:251`.
- **Reproducible scenario:** Make one asset fail three times and observe the
  displayed failed count.
- **Impact:** Misleading status can make one failing photo appear to be several
  failed photos.
- **Confidence:** High.
- **Recommendation:** Track attempt failures separately from unique terminal
  failures and label both precisely.
- **Migration/compatibility:** None.
- **Remediation:** `failedCount` now reflects unique terminal failed items.

### PB-04: Dedicated automated photo-backup coverage was absent

- **Original behavior:** The Android package exposed lint/start/build scripts but
  no test script. Repository search found no dedicated SyncEngine, SyncQueue,
  SyncWorker, sync-check, or photo-backup lifecycle tests.
- **Evidence:** `xenode-expo/package.json`; supporting Web APIs exist but lack
  backup-specific lifecycle fixtures.
- **Reproducible scenario:** Inspect package scripts and test files.
- **Impact:** Queue recovery, dedup races, account isolation, and failure
  handling can regress without detection.
- **Confidence:** High.
- **Recommendation:** Add unit, integration, backend contract, and device
  recovery suites before declaring production readiness.
- **Migration/compatibility:** None.
- **Remediation status:** Fifteen focused cross-repo tests now cover confirmed
  hardening paths. A native Android test harness and physical-device matrix
  remain release work.

## Observations requiring validation

### PB-O1: Background reliability across devices

- **Current behavior:** Android uses a real foreground service plus periodic
  WorkManager safety net and OEM guidance.
- **Evidence:** `xenode-expo/src/sync/SyncNotificationService.ts:62`,
  `xenode-expo/src/sync/SyncWorker.ts:175`, and
  `xenode-expo/src/sync/BackgroundPermissions.ts`.
- **Why unresolved:** Source intent does not prove behavior after force-stop,
  reboot, OEM task killing, notification denial, or prolonged device idle.
- **Impact if insufficient:** Delayed or stalled backup.
- **Confidence:** Medium.
- **Validation:** Run the device matrix below before classifying defects.

### PB-O2: Whole-queue AsyncStorage scalability

- **Current behavior:** SQLite stores long-lived identity mappings, while the
  active queue remains a JSON blob that is periodically rewritten.
- **Evidence:** `xenode-expo/src/sync/SyncDb.ts` and queue persistence in
  `SyncStorage`.
- **Why unresolved:** The queue is naturally bounded by the selected library,
  but no measured limits exist for 10k-100k pending assets or process death
  during a coalesced write.
- **Impact if insufficient:** Slow analysis/resume or queue-state loss.
- **Confidence:** Medium.
- **Validation:** Benchmark serialization, hydration, and interruption at
  representative large-library sizes.
- **Progress:** A 100k-item queue serialization round trip is regression-tested
  below a 30 MiB payload limit. Hydration timing, interruption, and memory
  pressure still require device measurement. Critical queue saves now surface
  persistence failures instead of silently succeeding.

### PB-O3: Failure classification

- **Current behavior:** Transient errors use bounded retry. Session expiry,
  quota exhaustion, and lost authorization block the queue without consuming
  per-item retries. Other media, presign, encryption, and upload failures still
  require broader typed classification and failure injection.
- **Why unresolved:** User-visible propagation and actual behavior for expired
  presigned URLs, revoked permissions, corrupt media, and quota require failure
  injection.
- **Impact if insufficient:** Wasteful retries and poor recovery guidance.
- **Confidence:** Medium.
- **Validation:** Inject typed failures at every pipeline phase and inspect
  retry, cleanup, and UI behavior.

### PB-O4: Migration retry behavior

- **Original behavior:** The legacy AsyncStorage-to-SQLite migration wrote the
  migration-complete flag even after migration failure.
- **Evidence:** `xenode-expo/src/sync/SyncDb.ts:139`.
- **Why unresolved:** Fingerprint reconciliation may recover all practical
  cases, but the cost and duplicate behavior have not been measured.
- **Impact if insufficient:** Re-upload work or temporarily incomplete
  local/cloud pairing after upgrade.
- **Confidence:** Medium.
- **Validation:** Corrupt/fail migration storage, then verify dedup and gallery
  reconciliation after restart.
- **Progress:** A failed migration no longer writes the completion flag and is
  retried on the next process launch. Runtime fault injection remains required.

## Confirmed strengths and non-issues

- **E2EE compatibility:** Accepted passing baseline; no crypto defect identified.
- **Account ownership defenses:** Key cache ownership, persisted config checks,
  and centralized logout cleanup are present.
- **Plaintext fallback:** No intentional plaintext backup fallback was found.
- **Dedup security:** Fingerprints are per-user keyed values; backend sync-check
  verifies ownership and filters deleted objects.
- **Race handling:** Finalization checks content fingerprints, atomically
  enforces one active object per bucket/fingerprint, and deletes duplicate
  cloud blobs when a concurrent insert loses the race.
- **Resource controls:** Upload concurrency is two; variants upload sequentially;
  temporary files use cleanup paths.
- **User intent:** Paused state is persisted and background workers do not
  silently resume paused backup.

## Missing reliability controls

- No charging-only or battery-threshold policy.
- No detailed backup-history or diagnostic screen.
- No demonstrated device/OEM compatibility matrix.

## Deployment prerequisite

Before deploying the `active_sync_content_unique` partial unique index,
reconcile any existing duplicate active `(bucketId, syncContentFp)` rows. The
index permits re-upload when the previous matching object is in Bin
(`deletedAt` is non-null). This is a metadata-index deployment concern only and
does not change encrypted formats or client interoperability.

## Required validation matrix

| Scenario | Expected evidence |
| --- | --- |
| Process killed during each upload phase | Queue resumes without false success or duplicate object |
| Reboot with running, paused, and null intent | Only running intent resumes; other states remain user-controlled |
| Logout/account switch during active and pending sync | No keys, queue, mappings, previews, or worker activity crosses accounts |
| Notification permission denied | Backup clearly explains why Android background sync cannot start |
| Media permission revoked mid-run | No false synced row; actionable recovery is shown |
| File removed or temporarily unavailable | Item remains recoverable and is not marked synced |
| Offline/presigned URL expiry/server 5xx | Correct retry/backoff, fresh presign, cleanup, and accurate UI |
| Quota exceeded | Retry stops and user receives actionable quota guidance |
| Duplicate from reinstall/two devices/race | One cloud object remains and local/cloud mapping is correct |
| 10k, 50k, and 100k pending assets | Measured analyze, persistence, memory, and recovery behavior |
| Representative Samsung, Pixel, Xiaomi, Oppo, Vivo devices | FGS/WorkManager behavior documented under idle, lock, reboot, and OEM restrictions |

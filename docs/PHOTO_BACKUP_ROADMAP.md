# Xenode Photo Backup Hardening Roadmap

Date: 2026-06-15

This roadmap recommends incremental changes only. It does not implement them
and does not change the existing E2EE format.

## Progress

- P1.1 implemented and covered by focused regression tests.
- P1.2 implemented: durable failures, reasons, retry-all, targeted retry, and
  per-item removal are available.
- P1.3 started with queue, unavailable-media, retry-policy, account-isolation,
  migration, large-queue serialization, cross-client E2EE, and live backend
  sync-check/finalization contract coverage.
- P2.1 started: permanent API 4xx failures now stop immediately while transient
  failures retain retry behavior. Session expiry, quota exhaustion, and lost
  storage authorization now block the queue once without failing each photo.
- P2.2 started: account-scoped last-success health plus pending and failed
  counts are visible in backup settings; detailed history remains.
- P2.3 started: account-scoped Wi-Fi-only policy is enforced with a recoverable
  blocked state and connectivity-change resume. Charging and battery-threshold
  policies remain.
- Low-device-storage preparation now blocks without consuming retries, and
  generated image variants join guaranteed upload cleanup.
- P2.4 started: critical queue persistence failures are surfaced and a
  100k-item serialization round trip is regression-tested.
- P3.1 implemented in code: failed legacy migrations retry on the next launch.
- Backend finalization now rolls back quota-rejected uploads and atomically
  prevents duplicate active content fingerprints. Deployment must reconcile
  any pre-existing active duplicates before creating the unique index.
- Quota accounting now atomically rejects concurrent over-limit uploads and
  handles existing-object resize accounting without inflating object counts.

## P0 - Release gate

No confirmed cross-account exposure, plaintext fallback, or cryptographic
compatibility defect was found in this audit. No P0 crypto or data-migration
work is recommended without new reproducible evidence.

## P1 - Reliability and recovery

### P1.1 Introduce explicit upload outcomes

- **Evidence:** Missing/unresolvable assets return normally from `_uploadItem`,
  then `_finalizeItem` marks them done and synced.
- **Expected outcome:** Only uploaded or confirmed-existing assets become synced;
  unavailable assets remain recoverable.
- **Risk:** Moderate; changes queue-finalization semantics.
- **Compatibility impact:** No encrypted-object change. Reconciliation may be
  needed for existing false synced rows.
- **Dependencies:** Define outcome states and recovery policy.
- **Required tests:** Missing file, revoked permission, iCloud-only asset,
  transient unavailability, and successful retry.

### P1.2 Preserve and expose terminal failures

- **Evidence:** Five failed attempts become `skipped`; the queue can then clear
  without a durable retry/details surface.
- **Expected outcome:** Users can see, retry, or dismiss every unresolved item.
- **Risk:** Low to moderate; adds persistent failure state and UI.
- **Compatibility impact:** Account-scoped local schema only.
- **Dependencies:** P1.1 outcome semantics.
- **Required tests:** Retry exhaustion, relaunch, process death, manual retry,
  dismissal, and account switch.

### P1.3 Add backup lifecycle test harness

- **Evidence:** Android has no test script or dedicated backup tests.
- **Expected outcome:** Queue, recovery, account isolation, dedup, and backend
  contracts become regression-protected.
- **Risk:** Low.
- **Compatibility impact:** None.
- **Dependencies:** Mockable media library, storage, network, and worker seams.
- **Required tests:** Queue ordering/persistence, retry backoff, process
  recovery, logout, account switch, dedup race, cleanup, and finalization.

### P1.4 Complete representative-device validation

- **Evidence:** FGS, WorkManager, and OEM guidance exist, but runtime guarantees
  are unproven.
- **Expected outcome:** Supported Android behavior and limitations are explicit.
- **Risk:** Low.
- **Compatibility impact:** None unless validation demonstrates a defect.
- **Dependencies:** Repeatable device test protocol and diagnostic capture.
- **Required tests:** Pixel, Samsung, Xiaomi, Oppo, and Vivo under lock, idle,
  process death, reboot, force-stop, and battery restrictions.

## P2 - Operational controls and clarity

### P2.1 Classify failures and provide actionable recovery

- **Evidence:** Most failures share one generic retry path; quota and permission
  recovery are not backup-specific.
- **Expected outcome:** Retry only transient failures and explain blocked states.
- **Risk:** Moderate; incorrect classification could suppress valid retries.
- **Compatibility impact:** None.
- **Dependencies:** Typed errors from media, presign, upload, finalization, and
  quota paths.
- **Required tests:** Offline, timeout, 401, 403, 5xx, expired URL, quota,
  corrupt file, permission denial, and low storage.

### P2.2 Add backup health and history

- **Evidence:** Current UI focuses on active work and labels failed attempts as
  failed photos.
- **Expected outcome:** Show last successful backup, pending count, terminal
  failures, blocked reason, and accurate attempt/item counts.
- **Risk:** Low.
- **Compatibility impact:** Account-scoped local state only.
- **Dependencies:** Durable terminal-failure model.
- **Required tests:** State accuracy across retry, completion, relaunch, logout,
  and account switch.

### P2.3 Add network and power policies

- **Evidence:** No Wi-Fi-only, cellular, charging-only, or battery-threshold
  control was found.
- **Expected outcome:** Users can prevent expensive or disruptive large-library
  backups.
- **Risk:** Moderate; policy evaluation can accidentally stall backup.
- **Compatibility impact:** Account-scoped settings only.
- **Dependencies:** Connectivity/power observers and clear blocked-state UI.
- **Required tests:** Network transitions, metered networks, charging changes,
  reboot, and policy changes during active upload.

### P2.4 Validate and harden large-queue persistence

- **Evidence:** Long-lived mappings use SQLite, but the active queue remains a
  whole AsyncStorage JSON blob.
- **Expected outcome:** Documented performance and crash consistency at target
  library sizes; move queue storage only if measurements justify it.
- **Risk:** Moderate if a storage migration becomes necessary.
- **Compatibility impact:** Potential local-only migration; no cloud impact.
- **Dependencies:** Benchmarks at 10k, 50k, and 100k pending items.
- **Required tests:** Hydration time, serialization time, interruption during
  save, memory pressure, and process recovery.

## P3 - Longer-term resilience

### P3.1 Make legacy migration retryable and observable

- **Original evidence:** SQLite migration marked itself complete after failure.
- **Expected outcome:** Migration failures can retry safely or reconcile with
  explicit diagnostics.
- **Risk:** Low to moderate; repeated migration must remain idempotent.
- **Compatibility impact:** Local-only.
- **Dependencies:** Migration-state model and metrics.
- **Required tests:** Corrupt input, partial transaction, storage exception,
  retry, and post-migration dedup.
- **Progress:** Retryability is implemented and statically regression-tested;
  runtime fault injection and diagnostics remain.

### P3.2 Add privacy-preserving diagnostics

- **Evidence:** Operational behavior relies heavily on console logs and there is
  no backup-health diagnostic artifact.
- **Expected outcome:** Support can diagnose stalls without exposing filenames,
  keys, plaintext, or sensitive metadata.
- **Risk:** Moderate privacy risk if fields are not tightly allowlisted.
- **Compatibility impact:** None.
- **Dependencies:** Redaction policy and opt-in/export UX.
- **Required tests:** Redaction, account scoping, logout cleanup, and malformed
  error handling.

## Release readiness exit criteria

- PB-01 and PB-02 are fixed and regression-tested.
- Backup-specific unit and integration suites run in CI.
- Account-switch/logout tests prove no cross-account state survives.
- Duplicate prevention is tested for reinstall, two-device, and race scenarios.
- The active-fingerprint unique index is deployed after duplicate-row
  reconciliation.
- Temporary-file cleanup and quota/permission failure behavior are verified.
- The representative-device matrix has documented results and limitations.
- Remaining observations are explicitly accepted, mitigated, or scheduled.

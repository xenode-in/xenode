# Xenode Photo Backup Discovery

Date: 2026-06-15

## Purpose and evidence standard

This document describes the photo-backup implementation as it exists. It does
not propose a cryptographic redesign. Existing Web/Android encrypted-file
interoperability is accepted as a passing baseline.

Evidence confidence:

- **High**: deterministic source path or directly enforced API contract.
- **Medium**: source intent is clear, but runtime behavior depends on the OS,
  device, network, or storage provider.
- **Low**: hypothesis requiring targeted validation.

## Architecture summary

The Android backup system is a persistent media-discovery and encrypted-upload
pipeline. `SyncEngine` owns analysis, queue processing, upload orchestration,
and lifecycle state. `SyncQueue` owns item ordering and retries.
`SyncStorage` persists the queue, configuration, scan cursor, and user intent.
`SyncDb` stores the durable local-to-cloud identity map in SQLite.

Primary entry points:

- App startup registers background work and initializes notifications in
  `xenode-expo/src/app/_layout.tsx:115`.
- `GlobalHeader` configures/resumes backup and observes new media in
  `xenode-expo/src/components/GlobalHeader.tsx:330`.
- The backup settings screen selects full-library or album scope and fires the
  explicit start workflow in `xenode-expo/src/app/(drive)/sync.tsx`.
- Manual photo backup starts a foreground sync from the Photos experience in
  `xenode-expo/src/app/(drive)/photos.tsx:1527`.

## Lifecycle and data flow

1. **Configuration and account binding**
   - `SyncEngine.configure()` receives unlocked keys, user ID, bucket ID, and
     prefix, then persists account-owned configuration.
   - Cached keys carry an owner ID. Loading keys for a different user clears
     the cache and returns no keys
     (`xenode-expo/src/lib/crypto/keyCache.ts:42`).
   - The background worker rejects persisted sync configuration owned by a
     different user (`xenode-expo/src/sync/SyncWorker.ts:149`).

2. **Discovery**
   - `SyncEngine.analyze()` requests media-library access and scans photo
     assets in pages.
   - An empty album selection means full library; otherwise each selected album
     is scanned.
   - Incremental scans use the last confirmed-synced creation-time cursor.
     Queued-but-not-synced assets do not advance the cursor.
   - A live `MediaLibrary.addListener` path detects new captures and deletion
     events while the application process is available.

3. **Deduplication**
   - Tier 1: SQLite local asset ID.
   - Tier 2: bulk per-user metadata HMAC through `/api/objects/sync-check`.
   - Tier 3: per-user content HMAC before upload.
   - Tier 4: `/api/objects/complete-upload` content-fingerprint race guard,
     which best-effort deletes duplicate uploaded blobs and returns the
     existing object.
   - Backend sync checks require authentication, verify bucket access, ignore
     deleted objects, and scope shared system buckets to the caller's prefix
     (`xenode-nextjs/app/api/objects/sync-check/route.ts:82`).

4. **Queue construction and ordering**
   - Items use `pending`, `uploading`, `done`, `failed`, and `skipped` states.
   - Normal analysis orders the combined multi-album result by creation time.
   - Fresh captures and manual uploads are prepended so they run before older
     pending items.
   - Queue state is serialized to AsyncStorage. Writes during concurrent
     completion are coalesced to approximately one write per 250 ms.

5. **Encrypted upload**
   - Two queue items may execute concurrently
     (`xenode-expo/src/sync/SyncEngine.ts:51`).
   - Each item generates thumbnail and optimized variants, reads plaintext,
     computes content identity, encrypts the variants and original, obtains
     presigned URLs, uploads sequentially, encrypts metadata/name/content type,
     and finalizes the cloud object.
   - The pipeline uses the existing E2EE implementation and sends
     `isEncrypted: true` during finalization.
   - Temporary upload files are tracked and deleted in the upload cleanup path.
   - Generated thumbnail and optimized variant files are included in the same
     guaranteed cleanup path.
   - Successful completion records local asset ID, cloud object ID, and
     fingerprints in SQLite.

6. **Retry and completion**
   - Retry count persists with the queue across launches.
   - Maximum attempts are five, with delays of 2, 6, 15, 45, and 120 seconds
     (`xenode-expo/src/sync/SyncQueue.ts:8`).
   - Retryable failures return to `pending`; terminal failures become
     durable `failed` items.
   - Automatic workers do not revive terminal failures. Users can retry all
     failures, retry one failure, or dismiss one failure from the backup modal.
   - The queue is cleared only after successful work has completed and no
     terminal failures remain.

7. **Background execution and recovery**
   - Android's primary path is a Notifee foreground service with pause, resume,
     and cancel actions.
   - A periodic `expo-background-task`/WorkManager task is registered with a
     15-minute minimum interval as a safety net
     (`xenode-expo/src/sync/SyncWorker.ts:207`).
   - The worker resumes only when persisted user intent is `running`.
   - If session, keys, or configuration cannot be restored, it prompts the user
     to reopen the app rather than uploading without an unlocked context.
   - OEM battery-optimization guidance and exemption requests are implemented,
     but their effectiveness requires device validation.
   - Account-scoped Wi-Fi-only policy is enforced before start and between
     queued items. Offline or disallowed-network work remains pending in a
     visible blocked state and is rechecked when connectivity changes.
   - A conservative free-device-storage preflight blocks before variant
     generation when encrypted upload preparation cannot safely proceed.

8. **Logout and account changes**
   - `secureSignOut()` first clears in-memory engine credentials, then attempts
     server sign-out, and finally clears keys, sync storage, SQLite mappings,
     thumbnails, and previews
     (`xenode-expo/src/lib/secureSignOut.ts:13`).
   - The profile, drawer, email-verification, and API sign-out paths route
     through centralized secure sign-out.

## User experience

- Backup scope supports Full Library or selected photo folders.
- The pre-sync modal displays scan progress, upload count, bytes, estimate,
  active queue items, progress steps, and failed-attempt count.
- The active sync control surface provides pause/resume; notifications also
  provide cancel.
- Gallery overlays and system notifications expose active progress.
- The backup modal exposes a durable terminal-failure queue with reasons,
  targeted retry, retry-all, and remove controls.
- Backup settings expose the account-scoped last successful backup timestamp,
  pending count, and terminal failed count.
- Backup settings expose an account-scoped Wi-Fi-only policy and explain when
  backup is waiting for connectivity.
- The UI does not yet expose a detailed successful-backup history view.

## Security boundary

- Fingerprints are opaque per-user HMAC values, not plaintext filenames or
  unkeyed content hashes.
- Filename, content type, metadata, optimized content, thumbnails, and original
  content follow the existing encrypted-object contract.
- This discovery found no evidence that photo backup intentionally falls back
  to plaintext.
- Cryptographic primitives, derivation, and object formats remain out of scope
  for change without a demonstrated compatibility defect.

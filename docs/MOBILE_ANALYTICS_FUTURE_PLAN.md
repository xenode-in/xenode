# Mobile Analytics Future Plan

This is intentionally deferred until the web analytics implementation is stable.
Mobile analytics must follow the same E2EE boundary as web: measure workflow
adoption, never the user's stored content.

## Must Keep Forbidden

- File names, folder names, paths, object keys, local asset URIs.
- Photo metadata such as precise location, captions, albums, descriptions, or
  Google Photos URLs.
- Recipient emails, user-generated text, recovery words, private keys, wrapped
  keys, sync fingerprints, or raw error payloads.
- Exact file sizes. Use buckets only.

## Phase 1: Shared Taxonomy

- Reuse the web event names where the workflows match:
  - `onboarding_completed`
  - `vault_configured`
  - `object_uploaded`
  - `object_downloaded`
  - `share_link_created`
  - `direct_share_created`
  - `passkey_added`
- Add mobile-only backup events:
  - `backup_run_completed`
  - `backup_item_failed`
  - `backup_item_skipped`
  - `backup_blocked`
  - `backup_degraded_start`
- Allowed mobile properties:
  - `platform`
  - `source`
  - `sizeBucket`
  - `contentTypeCategory`
  - `isEncrypted`
  - `objectCountBucket`
  - `recipientCountBucket`
  - `reason`
  - `durationBucket`

## Phase 2: Mobile Chokepoint

- Extend `xenode-expo/src/sync/backupTelemetry.ts` from console-only telemetry
  into a fire-and-forget POST to a new Next.js endpoint.
- Keep the current chokepoint: do not scatter analytics calls across the sync
  engine.
- Add a mobile analytics helper that mirrors `lib/posthog.ts` allowlists and
  bucket helpers.

## Phase 3: Backend Endpoint

- Add `POST /api/mobile/analytics`.
- Require an authenticated session.
- Accept only allowlisted event names and properties.
- Convert any counts/durations/sizes to buckets on the server too, even if the
  client already bucketed them.
- Forward to PostHog using the same hashed distinct ID strategy as web.

## Phase 4: Verification

- Add tests proving mobile analytics drops forbidden keys.
- Add tests for backup telemetry event bucketing.
- Add one sync-engine smoke test proving backup telemetry never throws or blocks
  the sync path.

## Priority Order

1. Backup health events.
2. Mobile upload/download adoption.
3. Mobile sharing adoption.
4. Mobile security feature adoption.
5. Mobile billing and subscription events.

# Photos audit

## What works in code

Photos is independent: its package imports shared infrastructure, not Drive source. `/library` resolves a Photos ProductSession and mounts `PhotosKeyAccess`. The product key is obtained through an Accounts handoff or restored from IndexedDB. APIs use the common database and personal Space IDs. **KEEP** the product separation; physical bucket sharing is an implementation detail.

The browser `UploadController` uses the shared queue and `PhotosUploadPolicy`. Images are decoded with `createImageBitmap`, then rendered to 512-pixel thumbnails and 2,560-pixel optimized JPEGs. Originals remain intact; canvas derivatives strip embedded original metadata and flatten transparency to white. Each variant receives an independent file DEK and IV. `photo-encryption.ts` binds content and DEK encryption to account, Space and object key using AAD. **KEEP** those bindings while moving reusable crypto into a versioned shared adapter.

Presign returns random keys in the account prefix. Browser PUTs send ciphertext directly. Completion validates the personal Space, bucket, key shape, variant uniqueness and actual object lengths, atomically reserves total variant bytes, then creates storage/asset records and updates bucket totals. Retrieval signs a five-minute direct GET after checking Photos ownership. PhotoTile/Lightbox decrypt only in the browser; the durable preview cache contains ciphertext. Crypto round-trip/context tests passed.

These paths are implemented, but were not proven end to end against a running browser and B2. **F14 is a concrete browser blocker**: `next.config.ts` permits `https://*.r2.cloudflarestorage.com` while the default storage endpoint is B2, and excludes the configured Drive realtime WebSocket origin. Correct encryption code cannot compensate for a browser policy that blocks its network path.

## Upload correctness and cleanup

Photos does not record a durable upload session or reservation at presign. The adapter ignores checkpoint arguments and uses `createMemoryCheckpointStore`. Reload/crash resume and abandoned-upload reclamation are not implemented by merely using UploadEngine. The 250 MiB web cap bounds input size but whole-blob crypto and three concurrent jobs can still consume substantial memory.

Completion dedup is a read-before-write sequence. Two completions for the same `assetId` can reserve quota and create storage rows before unique asset creation selects a winner. The catch block deletes the asset by shared `(assetId, spaceId, accountId)` rather than the losing operation's newly created asset identity. It can remove the winner. **FIX F12** with claimed upload IDs, idempotent state transitions and atomic metadata/quota operations.

Cleanup accepts any correctly shaped account-prefix key. Abort protects only Photos-owned references; a known Drive object under the same prefix/bucket is not protected. Completion's duplicate/size/quota error paths also delete caller-supplied variant keys without proving they belong to an upload session. **FIX F13** by binding all deletion to server-created upload ownership and protecting references across products. This is product isolation and data integrity, not evidence of arbitrary cross-account key access.

## Timeline, dates and scale

`PhotosService.timeline` uses a bounded 1–200 page size, fetches one extra record and emits a `(takenAt,id)` cursor. `MongoPhotosRepository.listTimeline` applies that tuple in its descending query. The schema indexes Space/time/asset ID. **KEEP** this better cursor design.

The browser requests 180 records at a time, merges loaded results into component state, groups by date and renders every loaded group/tile. `getTimelineWindow` is tested for 50,000 assets but has no production caller. Lazy preview loading is not DOM virtualization. **FIX F16** by connecting a measured, bounded rendering strategy to the real timeline and testing DOM size after repeated page loads.

The upload path records `File.lastModified` as `takenAt`. It does not extract EXIF capture time or preserve a timezone-aware date source. The provided metadata processor only reads bitmap dimensions. Videos receive no duration extraction, generated thumbnail, faststart adapter or chunked streaming encryption in this app. Lightbox downloads/decrypts the full original for videos. **MIGRATE** reusable Drive processing, with explicit original-vs-filesystem date semantics and bounded video behavior.

Search filters only loaded items by media type or formatted date. The scrubber navigates loaded date groups. Neither is a whole-library semantic/indexed search feature. **KEEP** the existing limited filter, and label it accurately until real local encrypted-metadata indexing exists.

## Albums, sharing and deletion

| Feature | Evidence | Classification/action |
| --- | --- | --- |
| Album persistence | POST validates asset membership/cover and saves `PhotoAlbumV2` | Implemented backend; **KEEP** Space consistency |
| Album name encryption | AlbumEditor asks for an “Encrypted name envelope” and sends input unchanged; server checks string length only | Implemented incorrectly; **FIX F15** |
| Album browsing | AlbumView draws colored placeholders from asset IDs; no media retrieval | Stub; **FIX** real asset rendering |
| Album listing | Fetches all albums, no cursor | Incomplete at scale; **FIX** pagination |
| Sharing | ShareDialog role selector ends with `setOpen(false)` | Stub; **FIX** or hide until real key/access flow exists |
| Trash/delete/restore | Asset API exports POST only; repository lacks corresponding lifecycle methods | Planned/unimplemented in standalone Photos; **FIX** before claiming full lifecycle |
| Backup/sync | Projection API accepts optional fingerprint; browser uploads use new random UUIDs and no fingerprint | Partial domain seam; **MIGRATE** a real client backup protocol |
| Large libraries | Cursor API is active; virtualization helper unused | Partially implemented; **FIX F16** |

F15 is more than missing polish: entering an ordinary album title of at least 16 characters persists that plaintext under a field named `encryptedName`. The existing user flow performs no encryption.

## Drive/Photos relationship

Drive's historical `PhotoAlbum` and album-share routes remain active alongside Photos' `PhotoAsset`/`PhotoAlbumV2`. Their schemas and key formats are not equivalent. The projection endpoint accepts any encrypted object in an accessible Space, including Drive-owned objects, but the content endpoint requires `productId: photos` and the Photos-specific wrap/AAD format. A metadata projection is not a content/key migration (F30).

`migrate-storage-ownership.ts` labels every object referenced by a PhotoAsset as Photos-owned; it does not convert DEK wrappers or duplicate the encrypted file under a new product key. Applied to a Drive projection, it can hide that object from Drive while still not making it decryptable by Photos. **INVESTIGATE / MIGRATE** only with an inventoried format-aware transfer plan. The script was inspected, not run.

The shared `photos` domain package is useful, but current completion bypasses PhotosService and raw-writes Drive's storage schema. **MIGRATE** shared storage authorization, upload manifests, metering and deletion to a server package. Keep image layout, albums, timeline and Photos-specific metadata policy in Photos.

## Production judgment

Photos is an encrypted upload/preview/timeline foundation with substantial missing product lifecycle work. Prioritize CSP, deletion ownership, completion concurrency and album encryption; then implement trash, albums and sharing; then finish EXIF, streaming, dedup, library virtualization and backup. Do not introduce cloud ML to compensate for missing local features. The AI plan has no runtime implementation yet.

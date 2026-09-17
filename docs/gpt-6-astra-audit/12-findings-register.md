# Evidence-backed findings register

All findings refer to the audited working tree. “Confirmed” means source behavior was traced; only explicitly identified probes/tests were executed. Each finding names its owning architecture and a concrete corrective action. The [evidence appendix](13-evidence-and-inventory.md) provides verified source-line starting points.

## F01 — Authentication exposes the Vault wrapping secret

**CRITICAL · REPLACE · New Accounts/Vault integration · Confirmed and synthetically reproduced**

Evidence: `apps/accounts/app/login/page.tsx` sends `password` to Better Auth sign-in/sign-up and passes the same value to `cacheArkFromLogin`; `app/onboarding/OnboardingWizard.tsx` passes it to `createAccountVault`. `lib/vault-setup.ts:createAccountVault` and `lib/password-vault.ts:createPasswordEnvelopeForArk` derive the wrapping key from that password. `lib/password-vault.ts:confirmVaultUnlock` sends it again to `/api/vault/unlock`, whose POST calls `verifyPassword`.

The server receives the password and stores all public KDF parameters and the ARK envelope. It can derive the wrapping key and open the ARK, then product keys/RSA material. This violates server-blind E2EE even though no route intentionally decrypts files. A synthetic test using actual Argon2/envelope functions recovered the identical ARK from those inputs.

Replace the secret ceremony with a reviewed design in which the server never receives sufficient unlock material. Preserve existing ARKs during migration; require a negative server-knowledge test. Do not claim that TLS, password hashing at rest or higher Argon2 cost solves this.

## F02 — Usable keys persist despite the memory-only requirement

**HIGH · FIX · New crypto-react plus deliberate convenience changes · Confirmed**

Evidence: `packages/crypto-react/src/index.tsx:unlock/restore/lock`, `persistent-store.ts:savePersistedKey/loadPersistedKey`; `apps/accounts/lib/ark-cache.ts`; `apps/drive/contexts/CryptoContext.tsx` auxiliary key persistence.

Product keys, ARK and Drive private/metadata keys are structured-cloned into IndexedDB. Non-extractable keys remain usable for decryption; the synthetic clone probe confirmed this distinction. Records have no expiry/session/key-version binding. `restore` and `unlock` can complete after a concurrent lock; deletion is best-effort and blocked deletion resolves successfully. `trustDevice:false` does not prevent ARK caching.

Enforce memory-only product keys, or explicitly change the requirement before implementing any opt-in remembered-key policy. Keep consented device wrapping distinct. Add lifecycle generation fencing, transaction-completion handling and browser tests for lock/reload/account switching.

## F03 — New passkey/2FA code bypasses Mongo adapter ID mapping

**HIGH · FIX · Uncommitted Accounts security work · Reproduced against installed adapter 1.6.25**

Evidence: `apps/accounts/app/api/account/passkeys/route.ts:GET/POST`, `app/security/page.tsx`, `app/api/account/two-factor/verify/route.ts:POST`, `lib/trusted-second-factor.ts:applyTrustedSecondFactor`. Installed `node_modules/@better-auth/mongo-adapter/dist/index.mjs` maps `id`→`_id`, `_id`→`id`, and reference IDs to ObjectId under default configuration.

Raw queries use `id` and string `userId`, and listings read `passkey.id`, even though those values are adapter-level representations. Default Better Auth records can fail binding/listing and second-factor persistence. Update results are not checked. The existing shared account repository already accounts for string/ObjectId compatibility, demonstrating the needed seam.

An isolated MongoMemoryServer probe created a synthetic user/session through Better Auth and a passkey record through its adapter. The raw record had no `id` field, `_id` and `userId` were ObjectIds, and both current raw filters returned no match. Use adapter calls or tested shared repositories; check matched counts. Test actual Better Auth-created documents rather than hand-seeded string-ID fixtures.

## F04 — Security gates and revocation differ by entry point

**HIGH · FIX · Accounts authority plus transitional custom APIs · Confirmed; composed exploit testing not performed**

Evidence: `lib/session.ts:needsSecondFactor/requireAccountsPageSession`; `app/api/auth/[...all]/route.ts:GET/POST`; custom `api/vault`, `api/vault/devices`, `api/space-product-keys`, `api/account/passkeys`; `api/vault/unlock:POST`; `lib/auth.ts:databaseHooks`; `lib/logout-coordinator.ts`.

Page/OIDC GET checks enforce custom OAuth 2FA, while many sensitive custom APIs require only the Better Auth session. OAuth sessions pending the local second factor can therefore reach these authenticated handlers. The unlock endpoint accepts `method: trusted-device` without proof of device possession; that produces an unlock-confirmation cookie, not a cryptographic key. Native Better Auth signout/revoke routes have no general deletion hook to revoke ProductSessions, while canonical UI logout performs extra coordination.

Centralize API auth/second-factor/recent-auth policy, make unlock confirmation mean what it claims, and converge issuer-session revocation paths. Verify POST authorization behavior and custom API CSRF/rate limits; do not assume Better Auth middleware wraps every Next route. This finding does not claim a cookie alone decrypts the Vault.

## F05 — Password rotation can separate login from decryptable Vault state

**HIGH · FIX · Uncommitted staged password workflow · Confirmed failure window**

Evidence: `components/security/PasswordChangeDialog.tsx`; `api/account/password/change/route.ts` (`PENDING_TTL_MS`, POST/PUT/DELETE); `lib/password-vault.ts:openArkWithPassword`; native `/api/auth/change-password` passthrough.

The client stages an envelope, changes the credential, then commits. If credential change succeeds and commit is lost for more than 15 minutes, login ignores the pending envelope and the new password cannot open the old active envelope. If the credential response is lost, the catch path may delete the stage because its local `credentialChanged` flag is false. Direct native password change also bypasses the envelope coordinator. Recovery/passkeys may rescue some users; that does not make the password path safe.

Implement durable idempotent reconciliation with a server-observable credential transition. Do not expire the only envelope matching a completed credential change. Route all relevant changes through the coordination contract and use the canonical revocation publisher rather than bare ProductSession updates.

## F06 — Concurrent Vault initialization can overwrite the wrong product keys

**HIGH · FIX · New Vault bootstrap · Confirmed ordering/race**

Evidence: `lib/vault-setup.ts:createAccountVault`; `api/space-product-keys/route.ts:PUT`; `api/vault/route.ts:PUT`.

Each bootstrap generates a fresh ARK and writes Drive/Photos envelopes via same-version upserts before committing the revision-zero Vault. Two tabs or a retry can overwrite those envelopes with material wrapped by a different ARK while only one Vault commit succeeds. Product-key PUT also accepts replacing the same version after setup without coordinating with the Vault. Ciphertext can become undecryptable without any database validation error.

Stage/commit the Vault and its initial product envelopes atomically, with one stable operation identity and stable browser-generated material on retries. Restrict replacement/rotation by explicit revision policy; zero sensitive buffers on failures as well as success.

## F07 — Resolving Space membership is not mutation authorization

**HIGH · FIX · Partially migrated tenant/action seam · Confirmed**

Evidence: `packages/spaces/src/authorization.ts:resolveSpaceAccess/assertSpaceAction`; `apps/drive/lib/authz/policy.ts:assertScopeAction/assertBucketAccess`; Drive `api/objects/presign-upload`, `presign-upload-multipart`, `complete-upload`, `purge`, `update-metadata`; Photos `api/photos/assets` and `albums` POST.

The resolver admits organization guests for read access. The cited mutations do not call the action helper; `assertBucketAccess` discards its action argument. Generic upload routes accept workspace headers and prefixes, so a guest can reach storage mutations even if product UI prevents it. Purge can delete binned workspace objects without the intended owner/admin action check. Photos projection/album writes similarly use membership only.

Require action authorization at the common route boundary and test each role against generic and org-specific routes. Preserve object/Space filters; they answer a different question from whether the role may mutate.

## F08 — Presigning is prefix permission, not ownership of an upload

**HIGH · FIX · Legacy storage assumptions retained after shared buckets · Confirmed**

Evidence: Drive `api/objects/presign-upload` and `presign-upload-multipart` accept `fileName` and construct keys under an allowed prefix; `complete-upload` enforces encryption-wrap fields only for non-personal Spaces; `folder:POST` accepts optional `encryptedDisplayName`.

An authenticated caller can choose a known existing key in its prefix and obtain a PUT URL without an object/version/product ownership check. Drive and Photos use the same personal prefix and physical bucket, so this can overwrite Photos ciphertext through Drive. Arbitrary filenames/MIME and missing encrypted personal fields are also accepted: ciphertext/opaque-key conventions are not enforced for alternative clients. Multipart `chunkCount` lacks a finite integer/upper bound.

Generate server-owned upload/variant keys, authorize overwrites through explicit object revision operations, bind resume to an upload ID, require supported encrypted metadata formats, and bound request sizes/chunk counts. Preserve only intentional compatibility under explicit versioned contracts.

## F09 — Purge can forget undeleted blobs and meters the wrong owner

**HIGH · FIX · Broken storage/Space migration · Confirmed**

Evidence: `apps/drive/lib/b2/objects.ts:deleteObjects`; `api/cron/purge-bin:GET`; `api/objects/purge:collectB2Keys/POST`.

`deleteObjects` catches transport errors and never checks `DeleteObjects` per-key errors. Callers proceed to hard-delete records. Purge projections omit current `chunks`, so chunked files' actual current blobs are not enumerated. Cron selects/meters `userId`, absent from the current StorageObject schema; org usage is not resolved from Space. A missing bucket skips blob work but does not exclude its rows from deletion. Manual purge can double-count overlapping folder/child selections and meters the caller rather than a canonical owner workspace.

Preserve retryable tombstones until every referenced blob is confirmed removed; enumerate all current/retained variants, deduplicate object IDs, resolve billing owner from Space, and reconcile counters idempotently. Add partial-S3-error, missing-bucket and chunked-trash tests before running purge against existing data.

## F10 — Orphan cleanup does not protect all retained references

**HIGH · FIX · Legacy upload ledger with partial protection · Confirmed conditional data-loss path**

Evidence: `api/cron/cleanup-orphans:GET`; `lib/uploads/session.ts`; Drive StorageObject product-filter middleware.

Cleanup only protects records with no `deletedAt`, and searches main/thumbnail/optimized fields but not all retained chunks/versions/products. A successful upload with a failed ledger-completion write, subsequently moved to Bin, can be deleted as an orphan before its restore window expires. It unions ledger keys with a prefix listing, broadening deletion beyond exact ownership. Failed listing/deletion can still retire ledger state.

Protect every retained reference including trash and other products, claim cleanup ownership, use exact manifests and record deletion outcomes. Keep stale sessions until cleanup is proven complete; test completion/cleanup races.

## F11 — Drive completion and reconciliation disagree with physical usage

**HIGH · FIX · Transitional file accounting · Confirmed**

Evidence: `api/objects/complete-upload:POST`; `lib/metering/usage.ts:incrementStorage/recalculateUsage`; `lib/authz/policy.ts:bucketOwnershipClause`; `models/StorageObject.ts`.

HEAD responses prove existence but their ContentLength is ignored. Chunk totals sum caller-provided sizes. Finalization can under-report bytes and quota; thumbnail/optimized bytes are not consistently counted. Fingerprint lookup uses bucket+fingerprint without Space in a shared regional bucket and can return another Space's matching record. Recalculation aggregates all Space objects (aggregation bypasses the Photos exclusion hook), but countDocuments excludes Photos and aggregate size omits Photos derivatives; version accounting also differs from `versionsTotalBytes` for shared-original snapshots.

Use one shared manifest/accounting definition, verify all variant lengths and scope dedup by product/Space. Test unauthorized fingerprint matches, size under-reporting, derivatives and retained-original accounting. Atomic quota increments alone do not validate the amount being incremented.

## F12 — Photos concurrent completion can delete the winning asset

**HIGH · FIX · New Photos lifecycle implementation · Confirmed interleaving**

Evidence: `apps/photos/app/api/photos/uploads/complete/route.ts:POST`, from existingAsset lookup through usage reservation, insertOne, PhotoAsset.create and catch compensation.

Two requests for the same asset can pass the initial read, reserve quota and insert storage rows. When one loses asset creation, its catch deletes by `(assetId,spaceId,createdByAccountId)`—the winning asset matches that filter. Process crashes between the multiple writes also leave unreconciled usage/records. There is no durable Photos upload ledger for later repair.

Claim an idempotent upload ID, atomically commit related database state where possible and scope compensation to IDs created by that attempt. Preserve uploaded bytes/reference state until the operation outcome is known. Test simultaneous and response-lost finalization.

## F13 — Photos cleanup can delete another product's objects

**HIGH · FIX · New Photos raw-storage path · Confirmed**

Evidence: `apps/photos/app/api/photos/uploads/abort/route.ts:POST`; completion helper `deleteUploadedObjects`; `lib/storage-server.ts:getPhotosStorageContext`.

Abort accepts up to three arbitrary account-prefix keys and protects only `productId: photos` references. A known Drive key is therefore disposable according to this query despite being valid Drive content in the same regional bucket. Completion's duplicate/size/quota cleanup likewise acts on submitted variant keys without an upload ownership record. Access is limited to the caller's prefix; the demonstrated problem is cross-product destruction within that account.

Require server-issued upload/session manifests and check all references independently of product before deleting. Do not use “not referenced by Photos” as proof of orphanhood.

## F14 — Photos CSP blocks the configured storage/realtime architecture

**HIGH · FIX · New app configuration · Confirmed with default B2 topology**

Evidence: `apps/photos/next.config.ts:headers` allows R2 under connect-src; `packages/config/src/storage.ts` defaults to B2; `UploadController` PUTs signed URLs; `photo-preview-cache.ts` fetches them; `SessionRevocationGuard` opens Drive WebSocket.

B2 PUT/GET and the separate realtime origin are absent from the policy. Those requests are blocked by a conforming browser under the default configuration. Deployments intentionally using allowed R2 endpoints have a narrower storage impact, but still need explicit realtime coverage.

Derive an exact allowlist from deployed storage/realtime origins and test actual response headers, uploads, previews and revocation in a browser. Do not solve this with unrestricted `connect-src *`.

## F15 — Photos album names are not encrypted by the user flow

**HIGH · FIX · New Photos album UI · Confirmed**

Evidence: `app/components/AlbumEditor.tsx:create`; `api/photos/albums/route.ts:POST`; `packages/photos/src/index.ts:PhotosService.createAlbum`.

The input named `encryptedName` is sent unchanged. Length ≥16 is accepted as an encrypted envelope. A user typing a sufficiently long ordinary name stores it plaintext. There is no client encryption/decryption call in this path.

Accept a normal title in UI, encrypt it locally with a product/Space/purpose-bound key, validate a versioned envelope shape, and decrypt it in album listing/detail. Add an assertion that outbound/server records do not contain the entered title.

## F16 — Photos scalability and feature claims exceed implementation

**MEDIUM · FIX · New Photos product scaffolding · Confirmed**

Evidence: `Timeline.tsx`, `TimelineSection.tsx`, `lib/virtual-timeline.ts`, `ShareDialog.tsx`, `AlbumView.tsx`, `PhotosShell.tsx`.

All loaded assets are mounted; the tested window helper is not imported by production UI. Share “Continue” only closes the dialog. AlbumView renders gradients/icons, not assets; settings/help have no action. Search covers loaded date/type values only. These are concrete unwired paths, not visual-quality judgments.

Connect real virtualization and workflows, or accurately disable unfinished actions. Test user-visible outcomes and mounted item counts, not helper existence or matching source text.

## F17 — Upload journals lose workspace context and retain plaintext names

**MEDIUM · FIX / MIGRATE · Drive resume adapter · Confirmed**

Evidence: `lib/db/local.ts:UploadRecord`; `contexts/UploadContext.tsx` saveUploadRecord calls and resume completion bodies; `lib/uploads/persistence.ts:markChunkComplete`.

Records omit Space ID and wrappedBy/spaceKeyVersion/spaceKeyWrapIv. Resumed requests cannot reconstruct workspace wrapping metadata; several use bare fetch. Active uploads also read current workspace refs rather than immutable per-job scope, making workspace changes worth explicit race testing. Records persist actual filenames, while encrypted-only journal comments imply otherwise. Chunk checkpoint updates use non-transactional read/modify/write.

Persist a versioned encrypted journal with immutable account/product/Space context and complete wrap descriptors. Route requests using the job scope, use transactional checkpoints, and test reload/Space-switch cases. Files beyond the ciphertext cap must clearly require re-selection/restart.

## F18 — Workspace rotation strands old content and reuses root keys for metadata

**HIGH · FIX / MIGRATE · Normalized records with legacy browser runtime · Confirmed path**

Evidence: `api/orgs/[orgId]/members/[memberUserId]/route.ts` retires older product keys; `packages/spaces/src/product-keys.ts:listMemberProductKeys` returns active only; `lib/orgs/useWorkspaceSpaceKey.ts` selects `keys[0]`; object wraps retain their original `spaceKeyVersion`.

Removal/demotion distributes a new key and retires remaining members' old grants, but does not rewrap old objects or select historical grants by object version. A fresh browser after rotation receives the new key and cannot unwrap old DEKs. The same raw workspace AES key also becomes the metadata key instead of the mandated HKDF purpose key.

Preserve authorized historical reads until client rewrap completes, or provide a version-aware keyring. Use product/Space/purpose derivation for new metadata with explicit compatibility. Test reading old/new files after member removal and after cache clearing.

## F19 — Drive still proxies bytes and CDN cache can outlive URL authorization

**MEDIUM · MIGRATE / FIX · Legacy transfer path · Confirmed**

Evidence: `lib/b2/objects.ts:getDownloadUrl`; `lib/b2/cdn.ts:generateFileToken/getSignedFileUrl`; `api/files/[bucket]/[...key]/route.ts:GET`; `lib/storage/applyContentUpdate.ts`.

Drive downloads stream through Next; editor ciphertext saves also pass through application memory. This violates the direct-storage architecture but is not itself plaintext disclosure. Proxy responses always permit 3,600 seconds of public cache even when a windowed token has only seconds left. A compliant shared cache can serve its fresh entry without invoking origin token validation, contrary to the route comment. Ciphertext URLs can also survive share/session revocation until capability expiry.

Move transfer to signed storage URLs with explicit scope/lifetime and client range handling. While the proxy remains, cap cache freshness by remaining token lifetime and define revocation semantics accurately.

## F20 — Timestamp-only sync can permanently skip records

**MEDIUM · FIX · Legacy local-first cache layer · Confirmed**

Evidence: `api/files/sync/route.ts:GET` queries `updatedAt > lastSync`, sorts only time, limits 1,000; `hooks/useSyncManager.ts` advances to maximum time and stores global `localStorage.lastSync`.

If more than one page shares a timestamp, later tied rows are skipped. The cursor is not account/Space-partitioned. Hard-deleted records have no durable sync tombstone, so a client offline beyond purge can retain stale local records. Full index rebuilds magnify cost on large libraries.

Use a stable tuple/revision cursor per account/product/Space, tombstones with an explicit retention/reset protocol, and incremental index updates. Test equal timestamps, account switching and long offline gaps.

## F21 — Billing plan state still has multiple writers

**MEDIUM · FIX · Partially migrated billing boundary · Confirmed**

Evidence: `api/objects/presign-upload`, `presign-upload-multipart`; `lib/metering/usage.ts:prepareUsageForStorageMutation/incrementStorage`; canonical `lib/subscriptions/service.ts:syncUserSubscriptionState`.

Storage paths directly set plan/free limits/price when local expiry passes. They bypass the canonical state writer and sanitized billing transition event path and can disagree with subscription grace/reconciliation policy. Photos separately mutates raw usage counters.

Converge plan state through the canonical service; expose a billing-safe storage permission/quota contract. Share byte metering across products without importing encrypted object content into billing logic.

## F22 — Checked-in deployment artifacts do not fit the current apps

**HIGH · FIX · Stale deployment / transitional renderer scaffold · Confirmed source contradictions; not container-tested**

Evidence: `apps/drive/Dockerfile`, `server.mjs`, root Compose files, `cron-entrypoint.sh`, `vercel.json`, `deploy/file-runtimes/editor/nginx.conf`, preview nginx config, `lib/office-editor/config.ts`, `tools/file-runtimes/editor/runtime.js`.

Docker install omits most required workspace manifests; runner lacks the file directly imported by server.mjs. Compose lacks Accounts/Photos deployment and required cookie/region env forwarding. Docker cron invokes removed PayU and omits jobs present in Vercel. Editor nginx allows only scaffold files/rejects queries, while the app requests a versioned OnlyOffice host with query. It also puts `limit_except` at server context, whereas nginx documents location context. Frame ancestors use the old root origin. The scaffold itself says Office is disabled.

Provide one reproducible all-product/runtime deployment, exact origins/secrets/regions and scheduler contract; validate startup, nginx syntax and iframe artifacts. [nginx directive reference](https://nginx.org/en/docs/http/ngx_http_core_module.html#limit_except). Exclude `.env*` backups from Docker context; absence of exclusion is a build-cache exposure risk, not proof of a leaked production secret.

## F23 — Lockfile contains current security advisories

**HIGH release-triage priority · FIX / INVESTIGATE · Runtime and tooling dependencies · Registry result reproduced; reachability conditional**

Evidence: root/app package manifests, `package-lock.json`, `npm audit --json` on the audit date; `SafePdfPreview.tsx` actively imports PDF.js when its path is selected; `server.mjs` uses Socket.IO.

22 package entries are reported affected: 2 critical, 11 high, 9 moderate. Next 16.2.11 is in the reviewed Windows-server RCE range; production Linux does not share that specific precondition. Other Next image, PDF.js and Socket.IO issues warrant exposed-runtime investigation. Vitest's critical UI-server classification does not mean `vitest run` exposed a UI server. The narrow Accounts resource-indicator rejection is mitigation to examine, not a package upgrade.

Upgrade affected packages based on applicable maintainer advisories and lockfile nodes, rerun crypto/auth/render tests, and verify feature/deployment exposure. See [dependency evidence](10-testing-production-readiness.md#dependency-posture) for primary sources. Do not apply `npm audit fix --force` blindly across the security-sensitive refactor.

## F24 — Legacy data safety has no complete migration/rollback proof

**HIGH conditional data risk · INVESTIGATE / MIGRATE · Old persisted state crossing new architecture**

Evidence: `docs/OPERATIONS.md` clean-database guidance; `docs/mongodb-indexes.md`; `tests/security/index-cleanup.test.ts`; `lib/crypto/fileEncryption.ts:decryptMetadataString`; `lib/workers/crypto-worker.ts`; current `scripts` inventory.

Schema tests show no new `deletedAt` TTL declaration, but cannot prove removal of an existing live index. No full Vault v1→v2 client-assisted data/key migration or rollback workflow was found. The reachable legacy metadata format embeds its decryption key in the value; existing rows using it are server-readable. Live population and indexes were not inspected.

Inventory ciphertext formats and indexes read-only, establish verified backups, write versioned idempotent migrations/dry-runs, retain old readers until conversion is proven. Never delete data to match the new schema, drop all indexes indiscriminately, or regenerate users' root keys as a migration shortcut.

## F25 — Sensitive text remains plaintext in metadata paths

**MEDIUM · MIGRATE · Legacy Drive metadata/sharing contracts · Confirmed**

Evidence: `api/objects/update-metadata:POST` writes description/googlePhotosUrl; `api/share:POST` persists user-authored bundleName; `models/StorageObject.ts`; Photos upload completion stores dates/dimensions/MIME.

Description/source links and bundle titles can reveal sensitive content despite encrypted file bytes. Precise dates/type/dimensions/relationships are additional privacy leakage, some deliberately used for queries. Server/client logs also use raw errors outside the analytics allowlist. No claim is made that every operational field must be encrypted regardless of function.

Encrypt private user text locally, define the minimal observable metadata contract and sanitize errors/logging. Audit existing values during migration; encryption field naming is not sufficient evidence of confidentiality.

## F26 — File formats lack one authenticated object/version contract

**MEDIUM · MIGRATE / INVESTIGATE · Legacy Drive crypto versus new Photos format**

Evidence: `apps/drive/lib/crypto/fileEncryption.ts:encryptFile/encryptFileChunked/encryptMetadataString`; `apps/photos/lib/photo-encryption.ts:additionalData`; `packages/crypto-core/src/envelope.ts:aad`.

Drive content/chunk and metadata encryption authenticates GCM ciphertext but does not bind the external object/Space/version/chunk position through AAD as Photos/envelopes do. Chunk IV/order/count and format selection are separate metadata. This is not evidence that AES-GCM is broken; it is an unauthenticated context/manifest boundary requiring substitution/reordering analysis against a malicious metadata server.

Design a versioned authenticated file/variant manifest and add adversarial context/chunk tests. Keep old readers and do not silently apply new AAD to existing ciphertext.

## F27 — Disabled administrators retain existing JWT authority

**HIGH · FIX · Separate legacy admin authentication · Confirmed**

Evidence: `apps/drive/lib/admin/session.ts:createAdminSession/getAdminSession/requireSuperAdminSession`; `api/admin/admins/[adminId]/route.ts:PATCH/DELETE`.

Admin JWTs last eight hours and embed role. Verification does not re-read the Admin's active status/current role or a revocation epoch. Disabling/deleting/demoting an Admin changes the database but leaves its already-issued token usable until expiry.

Validate current admin status/version for privileged requests and revoke on security/role changes. Keep Admin separate from Accounts; merging identities would not solve stale authorization.

## F28 — Realtime origin and lifetime enforcement is incomplete

**MEDIUM · FIX · Shared tickets with duplicate custom Node verifier · Confirmed source gap; no hostile socket test run**

Evidence: `apps/drive/server.mjs:verifyAndConsumeTicket`, Socket.IO options and connection handler; `packages/realtime/src/index.ts`; Photos SessionRevocationGuard.

Tickets are signed with a distinct secret, expire within 60 seconds and are atomically consumed with Redis NX—good controls. Allowed origins are supplied as CORS configuration, but there is no WebSocket `Origin` check/allowRequest gate. Browser WebSocket access is not enforced by ordinary CORS headers. A valid ticket is still required, so this is not an anonymous authentication bypass. Once connected, the server also lacks a timer tied to the underlying ProductSession expiry; explicit revocation events handle a different condition. Photos reuses the original one-use ticket for socket reconnection.

Enforce exact origin at handshake, share validation, refresh tickets on reconnect and define connection expiry/revalidation. Test hostile Origin, replay, reconnect, Redis failure and natural session expiry. Socket.IO documents that its CORS controls apply to HTTP long-polling, and recommends `allowRequest` for broader origin restrictions. [Socket.IO CORS documentation](https://socket.io/docs/v4/handling-cors/).

## F29 — Region labels can silently map to defaults

**MEDIUM · FIX / INVESTIGATE · New regional storage · Confirmed configuration behavior**

Evidence: `packages/config/src/storage.ts:storageEnvSchema/resolveRegionBucketConfig/regionForBucketName`; Photos `getPhotosStorageContext`; root Compose env list.

All regional missing endpoint/name values inherit the same schema defaults, including B2 us-west-004. Unknown bucket reverse lookup falls back to Asia. Credentials are checked later, so a partially configured region can point at an unexpected location rather than fail at provisioning. Default `asia` label does not establish Asia data residency. Compose omits US/EU variables entirely.

Validate complete distinct region provisioning, fail unknown bucket mapping, and verify physical residency/configuration before exposing immutable region choice. Do not infer deployed location from the label; actual deployment was not inspected.

## F30 — Photos projection/ownership migration is not a crypto migration

**HIGH conditional data-availability risk · INVESTIGATE / MIGRATE · Transitional Drive-to-Photos seam**

Evidence: `apps/photos/app/api/photos/assets/route.ts:POST` accepts encrypted objects by Space without product filter; content route requires Photos ownership and its wrap fields; `scripts/migrate-storage-ownership.ts` sets productId for all projected storage IDs.

A Drive object can become a PhotoAsset but fail Photos retrieval/decryption because Drive's key/format differs. Running the ownership script can hide it from Drive without rewrapping/re-encrypting it for Photos. The script does not distinguish a genuine Photos-native row missing a label from an older Drive projection.

Inventory provenance and crypto version; restrict projection to compatible product content or implement an explicit client-assisted transfer. Do not run the bulk ownership change until old reads, quotas and rollback are demonstrated.

## F31 — Release checks do not establish production readiness

**MEDIUM · FIX · Tooling/tests/documentation · Reproduced**

Evidence: root/package scripts, `.github/workflows/security.yml`, Drive Vitest setup, Photos source-string tests; executed results in chapter 10.

Typecheck and boundaries pass, while full tests and lint fail. `test:security` is only narrow lint. Photos window tests cover unused logic; many route tests mock auth/storage. CI/build/container versions differ (audit Node 24, workflow 22, Docker 20). These facts make “tests exist” an insufficient completion criterion, though the passing crypto/protocol/org tests are valuable.

Repair fixtures and lint, add composition/browser/storage-failure tests, align supported runtime versions, and run clean build/container/static-runtime gates. Keep this audit's unverified live-system claims explicitly open.

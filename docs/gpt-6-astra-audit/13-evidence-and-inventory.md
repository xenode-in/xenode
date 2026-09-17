# Evidence, inventory and audit limits

## Scope and method

The audit inspected the current repository at `3c863e5` and its existing working-tree changes, compared relevant pre-monorepo/history commits, inventoried first-party source and routes, searched for TODO/FIXME/legacy/migration/dead-code markers, traced the major identity/key/file/Photos flows, examined tests and deployment scripts, and ran the checks recorded in chapter 10.

The scope includes all three apps and 15 packages at the architecture/entry-point level. Critical flow implementations were read directly. Generated assets and vendored OnlyOffice internals were not exhaustively reviewed line by line; their loading, bridge, build and deployment seams were inspected. Route inventory is not a claim of dynamic penetration-testing every endpoint.

No real account sign-in, live database inspection, payment/refund action, B2 deletion, migration, rollout or production data export was performed. Local environment-file **names** and example variable names were inventoried; secret values were not copied into the audit. The pre-refactor history in this repository was used instead of assuming the adjacent older checkout was an authoritative baseline.

## Working-tree scope

At the first inspection, 23 tracked files were modified, concentrated in Accounts auth/profile/onboarding/security, plus Drive DashboardShell, Photos Lightbox/tests, shared database target models/UI dialog and lockfile. Untracked Accounts additions included passkey APIs/client helpers, staged password-change API, two-factor routes/trust helpers, SecurityCenter/password dialog, profile-image support/tests and a logo asset.

Those changes were preserved. Findings F03/F05 specifically concern the uncommitted security work. F01/F02 and many storage migration issues also exist in committed architecture paths; they are not all caused by the newest edits.

## Source inventory

First-party source inventory uses `rg --files apps packages -g '*.ts' -g '*.tsx' -g '*.mjs' -g '!**/public/**'` and excludes ignored build/dependency trees. It contains 923 files. Counts include tests and configuration in those extensions.

| Application | Source files | Route-handler files |
| --- | ---: | ---: |
| Accounts | 97 | 29 |
| Drive | 670 | 186 |
| Photos | 51 | 15 |
| Shared packages | 105 | Not applicable |

The app route counts include `/auth/*` handlers outside `/api`. API families inventoried include Accounts auth/account/Vault/product-session/key-handoff/profile/onboarding; Drive admin/auth/objects/files/buckets/shares/direct-shares/albums/orgs/billing/subscriptions/payment/refunds/support/cron/realtime/file-security/keys/passkeys; Photos auth/session/realtime/handoff/timeline/assets/albums/uploads.

## Test inventory and exact outcome

| Workspace | Test files | Tests passed | Tests failed |
| --- | ---: | ---: | ---: |
| accounts | 9 | 26 | 0 |
| drive | 56 | 288 | 2 |
| photos-web | 1 | 6 | 0 |
| config | 2 | 11 | 0 |
| contracts | 1 | 4 | 0 |
| crypto-core | 3 | 10 | 0 |
| crypto-react | 1 | 2 | 0 |
| database | 1 | 2 | 0 |
| identity-core | 1 | 7 | 0 |
| key-handoff | 1 | 4 | 0 |
| media-processing | 1 | 3 | 0 |
| photos | 1 | 5 | 0 |
| realtime | 1 | 4 | 0 |
| spaces | 1 | 5 | 0 |
| upload-engine | 1 | 2 | 0 |
| Total | 81 | 379 | 2 |

No coverage percentage is claimed. The configured Drive coverage include list is concentrated on billing/upload/cron; it is not a measure of the entire suite. Accounts/Photos integration coverage cannot be inferred from helper/source tests.

## Synthetic crypto probe

A temporary TypeScript script imported the actual `packages/crypto-core/src/index.ts` functions and `apps/accounts/lib/argon2.ts:deriveArgon2id`. It used a synthetic password/account only, with the application's 64 MiB / 3-pass / parallelism-1 parameters:

1. Generate ARK and salt; derive a client wrapping key; seal the password envelope.
2. Independently derive a second key using only that password and the stored public KDF parameters; open the stored envelope.
3. Compare original/recovered ARK bytes; result **true**.
4. Import a non-extractable ARK CryptoKey, structured-clone it, and decrypt a synthetic product envelope with the clone; result **true**.

This reproduces F01's cryptographic sufficiency and the usable-key distinction in F02. It does not claim the production server is secretly decrypting user data or that an actual IndexedDB persistence round trip was browser-tested. The source establishes the persistence call sites. The first temporary invocation needed Windows `file:///` import URLs; the corrected run exited zero.

## Isolated Better Auth adapter probe

A second temporary script started a disposable MongoMemoryServer and instantiated the installed Better Auth/Mongo adapter with the same default ID generation and `usePlural:false, transaction:false`. It created a synthetic account/session with `auth.api.signUpEmail`, then created a synthetic passkey model record using the actual adapter. It performed no WebAuthn ceremony and used no application/production database.

Results: raw passkey `id` absent; `_id` BSON type ObjectId; `userId` BSON type ObjectId; the new binding query using `id` plus string `userId` matched **false**; the custom session update filter matched **false**. The server and Mongo client were closed in `finally`. This dynamically confirms F03's record/query mismatch; it does not claim browser PRF integration was tested.

## Sources and confidence

Repository paths and named functions are the primary evidence. Installed Better Auth Mongo adapter 1.6.25 was read to resolve ID-conversion behavior; upstream guidance was consulted for API/security interpretation. Better Auth recommends explicit origin validation and describes its built-in security layers; Xenode's custom Next handlers must implement their own policy where they bypass that routing. [Better Auth security reference](https://better-auth.com/docs/reference/security), [passkey reference](https://better-auth.com/docs/plugins/passkey).

Dependency counts came from `npm audit --json` on this checkout. Applicable high-impact advisories were cross-checked against maintainer pages linked in chapter 10. They remain package/exposure findings until tested against the actual deployment; no exploit attempt was made.

**INVESTIGATE** outstanding deployment facts: live Mongo indexes and legacy populations; B2 bucket encryption formats, policies, versioning and region; actual nginx/CDN headers; installed static Office artifacts; external scheduler/Coolify settings; account recovery policy; native/mobile consumers and undocumented external API clients.

The appendix below records source starting lines from the files as audited. They are navigation aids, not a replacement for the complete execution trace in each finding.

## Verified source starting points

| Finding | Source | Starting line / searched symbol |
| --- | --- | --- |
| F01 | [apps/accounts/app/login/page.tsx](../../apps/accounts/app/login/page.tsx#L251) | 251 — `await cacheArkFromLogin` |
| F01 | [apps/accounts/lib/password-vault.ts](../../apps/accounts/lib/password-vault.ts#L177) | 177 — `export async function confirmVaultUnlock` |
| F01 | [apps/accounts/lib/vault-setup.ts](../../apps/accounts/lib/vault-setup.ts#L37) | 37 — `export async function createAccountVault` |
| F02 | [packages/crypto-react/src/index.tsx](../../packages/crypto-react/src/index.tsx#L89) | 89 — `const restore = useCallback` |
| F02 | [packages/crypto-react/src/persistent-store.ts](../../packages/crypto-react/src/persistent-store.ts#L72) | 72 — `export async function savePersistedKey` |
| F02 | [apps/accounts/lib/ark-cache.ts](../../apps/accounts/lib/ark-cache.ts#L25) | 25 — `export async function cacheAccountRootKey` |
| F03 | [apps/accounts/app/api/account/passkeys/route.ts](../../apps/accounts/app/api/account/passkeys/route.ts#L135) | 135 — `id: body.passkeyId` |
| F03 | [apps/accounts/lib/trusted-second-factor.ts](../../apps/accounts/lib/trusted-second-factor.ts#L76) | 76 — `id: session.session.id` |
| F03 | [apps/accounts/app/api/account/two-factor/verify/route.ts](../../apps/accounts/app/api/account/two-factor/verify/route.ts#L60) | 60 — `id: existing.session.id` |
| F04 | [apps/accounts/lib/session.ts](../../apps/accounts/lib/session.ts#L26) | 26 — `export function needsSecondFactor` |
| F04 | [apps/accounts/app/api/vault/unlock/route.ts](../../apps/accounts/app/api/vault/unlock/route.ts#L38) | 38 — `if (body.method === "password")` |
| F05 | [apps/accounts/app/api/account/password/change/route.ts](../../apps/accounts/app/api/account/password/change/route.ts#L12) | 12 — `const PENDING_TTL_MS` |
| F05 | [apps/accounts/components/security/PasswordChangeDialog.tsx](../../apps/accounts/components/security/PasswordChangeDialog.tsx#L56) | 56 — `let credentialChanged = false` |
| F06 | [apps/accounts/lib/vault-setup.ts](../../apps/accounts/lib/vault-setup.ts#L104) | 104 — `for (const productId` |
| F06 | [apps/accounts/app/api/space-product-keys/route.ts](../../apps/accounts/app/api/space-product-keys/route.ts#L102) | 102 — `const key = await SpaceProductKey.findOneAndUpdate` |
| F07 | [apps/drive/lib/authz/policy.ts](../../apps/drive/lib/authz/policy.ts#L130) | 130 — `void action;` |
| F07 | [apps/drive/app/api/objects/purge/route.ts](../../apps/drive/app/api/objects/purge/route.ts#L76) | 76 — `const ctx = await requireAccessContext` |
| F07 | [apps/photos/app/api/photos/albums/route.ts](../../apps/photos/app/api/photos/albums/route.ts#L39) | 39 — `export async function POST` |
| F08 | [apps/drive/app/api/objects/presign-upload/route.ts](../../apps/drive/app/api/objects/presign-upload/route.ts#L99) | 99 — `let safeFileName` |
| F08 | [apps/drive/app/api/objects/presign-upload-multipart/route.ts](../../apps/drive/app/api/objects/presign-upload-multipart/route.ts#L132) | 132 — `for (let i = 0; i < chunkCount` |
| F09 | [apps/drive/lib/b2/objects.ts](../../apps/drive/lib/b2/objects.ts#L75) | 75 — `export async function deleteObjects` |
| F09 | [apps/drive/app/api/cron/purge-bin/route.ts](../../apps/drive/app/api/cron/purge-bin/route.ts#L67) | 67 — `.select("_id bucketId userId` |
| F09 | [apps/drive/app/api/objects/purge/route.ts](../../apps/drive/app/api/objects/purge/route.ts#L53) | 53 — `const PURGE_PROJECTION` |
| F10 | [apps/drive/app/api/cron/cleanup-orphans/route.ts](../../apps/drive/app/api/cron/cleanup-orphans/route.ts#L91) | 91 — `const live = await StorageObject.findOne` |
| F11 | [apps/drive/app/api/objects/complete-upload/route.ts](../../apps/drive/app/api/objects/complete-upload/route.ts#L262) | 262 — `totalSize += chunk.size` |
| F11 | [apps/drive/lib/metering/usage.ts](../../apps/drive/lib/metering/usage.ts#L58) | 58 — `export async function recalculateUsage` |
| F12 | [apps/photos/app/api/photos/uploads/complete/route.ts](../../apps/photos/app/api/photos/uploads/complete/route.ts#L337) | 337 — `PhotoAsset.deleteOne` |
| F13 | [apps/photos/app/api/photos/uploads/abort/route.ts](../../apps/photos/app/api/photos/uploads/abort/route.ts#L40) | 40 — `const referenced =` |
| F14 | [apps/photos/next.config.ts](../../apps/photos/next.config.ts#L25) | 25 — `connect-src` |
| F15 | [apps/photos/app/components/AlbumEditor.tsx](../../apps/photos/app/components/AlbumEditor.tsx#L26) | 26 — `encryptedName,` |
| F16 | [apps/photos/app/components/TimelineSection.tsx](../../apps/photos/app/components/TimelineSection.tsx#L84) | 84 — `column.map((asset)` |
| F16 | [apps/photos/app/components/ShareDialog.tsx](../../apps/photos/app/components/ShareDialog.tsx#L72) | 72 — `Continue as` |
| F17 | [apps/drive/lib/db/local.ts](../../apps/drive/lib/db/local.ts#L19) | 19 — `export interface UploadRecord` |
| F17 | [apps/drive/contexts/UploadContext.tsx](../../apps/drive/contexts/UploadContext.tsx#L922) | 922 — `fileName: task.file.name` |
| F18 | [apps/drive/lib/orgs/useWorkspaceSpaceKey.ts](../../apps/drive/lib/orgs/useWorkspaceSpaceKey.ts#L68) | 68 — `data.keys[0]` |
| F18 | [packages/spaces/src/product-keys.ts](../../packages/spaces/src/product-keys.ts#L203) | 203 — `export async function retireOlderProductKeys` |
| F19 | [apps/drive/app/api/files/[bucket]/[...key]/route.ts](../../apps/drive/app/api/files/%5Bbucket%5D/%5B...key%5D/route.ts#L78) | 78 — `headers.set("Cache-Control"` |
| F19 | [apps/drive/lib/b2/cdn.ts](../../apps/drive/lib/b2/cdn.ts#L32) | 32 — `const currentBlockStart` |
| F20 | [apps/drive/app/api/files/sync/route.ts](../../apps/drive/app/api/files/sync/route.ts#L23) | 23 — `updatedAt: { $gt: lastSyncDate }` |
| F20 | [apps/drive/hooks/useSyncManager.ts](../../apps/drive/hooks/useSyncManager.ts#L42) | 42 — `localStorage.getItem("lastSync")` |
| F21 | [apps/drive/lib/metering/usage.ts](../../apps/drive/lib/metering/usage.ts#L33) | 33 — `async function prepareUsageForStorageMutation` |
| F22 | [apps/drive/Dockerfile](../../apps/drive/Dockerfile#L12) | 12 — `COPY apps/drive/package.json` |
| F22 | [apps/drive/server.mjs](../../apps/drive/server.mjs#L14) | 14 — `./lib/realtime/server-events.mjs` |
| F22 | [deploy/file-runtimes/editor/nginx.conf](../../deploy/file-runtimes/editor/nginx.conf#L14) | 14 — `limit_except` |
| F22 | [apps/drive/lib/office-editor/config.ts](../../apps/drive/lib/office-editor/config.ts#L21) | 21 — `export const ONLYOFFICE_HOST_URL` |
| F22 | [cron-entrypoint.sh](../../cron-entrypoint.sh#L13) | 13 — `payu/charge-recurring` |
| F23 | [apps/drive/components/dashboard/SafePdfPreview.tsx](../../apps/drive/components/dashboard/SafePdfPreview.tsx#L75) | 75 — `const pdfjs = await import` |
| F24 | [apps/drive/lib/crypto/fileEncryption.ts](../../apps/drive/lib/crypto/fileEncryption.ts#L521) | 521 — `// Legacy format: first 32 bytes` |
| F24 | [apps/drive/tests/security/index-cleanup.test.ts](../../apps/drive/tests/security/index-cleanup.test.ts#L8) | 8 — `does not recreate` |
| F25 | [apps/drive/app/api/objects/update-metadata/route.ts](../../apps/drive/app/api/objects/update-metadata/route.ts#L63) | 63 — `if (description)` |
| F25 | [apps/drive/app/api/share/route.ts](../../apps/drive/app/api/share/route.ts#L168) | 168 — `shareData.bundleName` |
| F26 | [apps/drive/lib/crypto/fileEncryption.ts](../../apps/drive/lib/crypto/fileEncryption.ts#L235) | 235 — `export async function encryptFileChunked` |
| F26 | [apps/photos/lib/photo-encryption.ts](../../apps/photos/lib/photo-encryption.ts#L20) | 20 — `function additionalData` |
| F27 | [apps/drive/lib/admin/session.ts](../../apps/drive/lib/admin/session.ts#L50) | 50 — `export async function getAdminSession()` |
| F28 | [apps/drive/server.mjs](../../apps/drive/server.mjs#L139) | 139 — `const io = new Server` |
| F29 | [packages/config/src/storage.ts](../../packages/config/src/storage.ts#L43) | 43 — `const storageEnvSchema` |
| F30 | [apps/photos/scripts/migrate-storage-ownership.ts](../../apps/photos/scripts/migrate-storage-ownership.ts#L24) | 24 — `const result = await database.collection` |
| F30 | [apps/photos/app/api/photos/assets/route.ts](../../apps/photos/app/api/photos/assets/route.ts#L43) | 43 — `const object = await getDatabase()` |
| F31 | [apps/drive/tests/security/drive-session-resolution.test.ts](../../apps/drive/tests/security/drive-session-resolution.test.ts#L17) | 17 — `async function seedAccount` |
| F31 | [apps/drive/package.json](../../apps/drive/package.json#L10) | 10 — `"lint:security"` |

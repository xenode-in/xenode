# Incremental remediation progress

The audit is a snapshot of the pre-remediation working tree. Findings are not closed merely because one supporting fix lands.

## Decisions

- The user selected a **separate Vault password, entered locally only**, for F01. Preserve existing ARKs and file access during migration; never send the new Vault password through Better Auth or server unlock verification.
- The user later clarified that Xenode has **no real users or production data**. Future implementation should favor the clean target architecture over legacy compatibility, migration, or rollback scaffolding for disposable development data. This supersedes the earlier production-rollout cautions as planning constraints; they remain historical context for the code already written.
- Commit each completed implementation increment, including regression tests and its validation record.
- Preserve pre-existing Accounts/UI work separately from remediation. It was checkpointed unchanged as `f928e94` before the overlapping Vault migration; this is a baseline commit, not a claim that its audited issues were fixed.

## Phase 0 increments

| Increment | Scope | Status |
| --- | --- | --- |
| 0A | Confirm storage deletion, protect retained references during orphan cleanup, enumerate chunked purge content | Complete; see validation below |
| 0B | Enforce action permissions on generic storage mutations | Complete; full test suite passed |
| 0C | Separate local Vault password and migrate existing envelopes without changing root keys | Committed as `dae2945`; rollout notes below |
| 0D | Normalize Better Auth Mongo IDs for passkey and second-factor records | Committed as `18709ac`; full suite passed |
| 0E | Keep root, product and Drive sharing keys in memory; opt into browser-device trust | Complete; full suite passed |
| 0F | Require OAuth second-factor completion and same-origin mutations at Accounts API boundaries | Complete; full suite passed |
| 0G | Revoke ProductSessions when Better Auth deletes issuer sessions | Complete; full suite passed |
| 0H | Deny presign collisions with referenced ciphertext and bound multipart inputs | Complete; full suite passed |
| 0I | Bind generic upload URL refresh and secondary blobs to pending reservations | Complete; full suite passed |
| 0J | Enforce unique physical-key claims and record development-only architecture policy | Complete; full suite passed |
| 0K | Issue Drive upload keys on the server and resolve refreshes from reservations | Complete; full suite passed |
| 0L | Bind generic Drive completion to claimed, Space-scoped uploads | Complete; full suite passed |
| 0M | Stop losing Photos completions and aborts from deleting another upload | Complete; full suite passed |
| 0N | Reserve Photos variant keys and bind completion/abort to a manifest | Complete; full suite passed |
| 0O | Lease and reconcile expired Photos upload cleanup through authenticated cron | Complete; full suite passed |
| 0P | Commit Photos manifests, metadata and usage in one database transaction | Complete; full suite passed |

The rest of the roadmap remains open. F09/F10 also require durable claim/reconciliation across concurrent finalize/restore/purge operations; a deletion confirmation patch alone is not complete lifecycle safety.

## 0A — Storage deletion safeguards

Commit: `14bb2da`.

- Bulk S3 deletion now propagates transport failures and rejects per-key errors, including HTTP-success responses containing failures.
- Orphan cleanup uses exact ledger keys and a shared cross-product reference repository covering current chunks, thumbnails, optimized variants, retained versions and Bin objects. Missing bucket metadata or deletion failure retains the ledger.
- Bin purge includes current chunk blobs and fails before deletion when bucket/Space-owner metadata is missing. Personal counters use the Space owner; organization/team counters use OrgUsage. Manual purge deduplicates overlapping selections.
- Regression validation: 36 tests passed across storage deletion, Bin/orphan safety, org governance and version metering. Root typecheck passed all 16 workspaces; boundary check and database lint passed. Changed Drive files passed scoped ESLint with two pre-existing unused-parameter warnings in the orphan test mock.
- The first test run found a test-hook issue: returning a mock from beforeEach registered it as cleanup. Corrected the test hook; the expanded run passed.
- Remaining F09/F10 work: durable deletion claims/reconciliation, concurrent restore/finalize exclusion, cross-object retained-reference protection during purge, and fully atomic metadata/metering effects. No live cron or storage deletion was executed.

## 0B — Mutation permission checks

Commit: `6440e31`.

- Drive access-context resolution accepts an explicit action and delegates role enforcement to `@xenode/spaces`. Generic presign, completion, legacy upload, reorder, metadata, restore and object PATCH require write access; purge requires delete access. Bucket action checking is no longer ignored.
- Photos asset projection and album creation assert write permission after Space resolution. Guest denials return 403 before repository/storage mutations.
- Direct API regressions cover ten Drive mutation paths, guest reads, member writes and forbidden member deletion, plus guest/member Photos flows. Existing object state is checked after denial and successful member reorder.
- Corrected stale Drive session-resolution fixtures to create an onboarded profile, encrypted Vault envelopes and a credential record. Added four missing-onboarding negative cases without relaxing the production resolver.
- Scoped Drive and Photos ESLint pass; removed four existing `any` escapes in touched route error handling. Root typecheck passed 16 workspaces and the final Drive typecheck passed; Photos lint and boundary checks passed.
- Targeted validation: 26 Drive tests, 9 Photos tests, a final 12-test permission rerun, and 7 session-resolution tests passed. The first full-suite run retained only the two known stale-fixture failures. After repairing those fixtures, the final full suite passed all 15 test workspaces: **418 tests**, including 324 Drive tests.
- Remaining: upload identity/key ownership (F08/F13), complete endpoint-wide tenant audit, and the other Phase 0 findings are not claimed fixed by these role checks.

## 0C — Separate local Vault secret

Commit: `dae2945`.

- Signup/login/2FA no longer stash the authentication password or use it to unlock/create the Vault. Onboarding collects a separate local Vault password; OAuth accounts are not forced to submit it as a new sign-in credential.
- Vault documents explicitly mark `passwordMode: separate`. Product readiness rejects unmigrated Vaults and sends users through Accounts continuation. Existing users open their original root key locally with the old Vault password or recovery phrase, then rewrap it under their new separate secret. Product, file, recovery and sharing key material is preserved.
- The client verifies that the recovered root opens the existing sharing-key hierarchy before replacing its password wrap. Historical pending password wraps remain locally readable for migration even if their retired staging TTL expired.
- `/api/vault/separate-password` accepts only a revision and encrypted envelope; it requires same-origin, recent authentication and completed second-factor state. A revision compare-and-set prevents competing writes; an identical operation can be retried after a lost response.
- Sign-in password change now updates only Better Auth credentials. Its public Better Auth alias delegates to the same coordinator. Product-session revocation excludes the current issuer session and uses the existing revocation publisher. Old staged password-commit endpoints return 410 and cannot overwrite the migrated Vault.
- Unlock confirmation no longer accepts/sends a Vault password. Its revised signed cookie is explicitly a navigation hint, not proof of key possession or authorization for sensitive server actions.
- Added a client-version header for Vault reads. Old browser bundles get `vault_client_update_required` and must reload before receiving envelopes they might handle using the retired password-coupling code.
- Interrupted onboarding that already has a Vault skips key/recovery-kit generation rather than replacing existing key material. New bootstrap performs an existing-Vault preflight and clears its sensitive buffers on failure as well as success. Atomic multi-record initialization (F06) remains a separate unresolved task.

### Validation

- Full `npm run test -- --force`: all 15 workspaces passed, **432 tests** (324 Drive, 40 Accounts, 9 Photos app, 59 shared-package tests).
- After the compatibility fence was added, the final Accounts run passed **41 tests**, including the additional old-client rejection test. Final Accounts typecheck/lint pass; root typecheck passed all 16 workspaces; database lint and package boundaries pass.
- Runtime crypto tests cover new Vault payloads, root-preserving rewrap, inability to decrypt the new wrap with the login password, recovery without transmitting the phrase, and identical retry payloads. Disposable Mongo integration tests cover atomic revision conflicts, idempotency, retained non-password envelopes, raw-secret rejection, auth/origin/2FA gates, OAuth readiness and independent sign-in password changes.
- No live account was migrated, no production database was modified, and no real browser/WebAuthn/provider/deployment run is claimed. Existing passkey/2FA adapter-ID issues (F03), persistent key lifetime (F02), and other audit findings remain open.

### Rollout and rollback constraints

1. Deploy the Accounts compatibility/migration flow together with the corresponding shared readiness contract; refresh old tabs when instructed. Test password, OAuth, recovery and supported passkey journeys in staging before production rollout.
2. Users must choose a Vault password different from their sign-in password. The server cannot check equality without learning the Vault secret; the browser rejects reusing a supplied old password during migration and labels the separate inputs explicitly.
3. Migration rewrites only the password envelope. Back up encrypted Vault records before rollout; do not bulk-generate new ARKs or mark old rows separated without the client rewrap.
4. Once users migrate, do **not** roll Accounts back to a client that transmits Vault passwords or assumes they match sign-in credentials. Prefer a forward fix retaining the separated-secret protocol and encrypted envelopes.
5. Rewrapping does not revoke an ARK already learned by a previously compromised server and cannot erase old envelope backups. Retrospective compromise recovery requires a separately designed key/content rotation plan.

## 0D — Better Auth Mongo record mapping

Commit: `18709ac`.

- A shared `@xenode/database` repository maps Better Auth's external string IDs to raw Mongo `_id` and `userId` fields. Passkey lookup/listing now uses this repository and checks both account and credential ID. Both native ObjectId and historical string IDs remain readable.
- The combined passkey binding route now finds actual adapter-created passkeys. A duplicate binding request can no longer delete the first request's winning binding during compensation. Reading a Vault passkey envelope also checks that its native passkey is still registered.
- OAuth second-factor verification and trusted-device continuation update the actual native session row, require the current account/session pair and an unexpired session, and fail closed if that write cannot be confirmed.
- Eight disposable Mongo integration tests create users, sessions and passkeys through the installed Better Auth adapter. They cover owner and credential isolation, duplicate binding, both TOTP/backup route branches with mocked code verification, trusted-device persistence, missing/expired sessions and historical string IDs. Real WebAuthn and authenticator ceremonies are still a later integration gate.
- Targeted integration tests pass (8/8). Full `npm run test -- --force` passed all 15 workspaces: **441 tests** (324 Drive, 49 Accounts, 9 Photos app, 59 packages). Root typecheck passed 16/16 workspaces. Accounts/database lint and package boundaries pass.

## 0E — Key lifetime and explicit browser trust

- `ProductCryptoProvider` no longer restores or persists Drive/Photos product keys. A fresh tab performs another Accounts handoff. In-flight handoffs lose a race against lock/logout through a generation check, including Drive's sharing-key state.
- Accounts ARK cache is a per-tab memory map. Switching account clears the prior entry; sign-out clears it. New code never loads the old persisted ARK and attempts removal of the historical IndexedDB database.
- Drive's RSA sharing-private, sharing-public and metadata keys are held in component memory after handoff. Old auxiliary IndexedDB databases are cleanup targets only. Shared persistence functions reject writes except for the Accounts browser-device wrapping-key store.
- New-account onboarding does not enroll a persistent browser device by default. The user may explicitly select “Trust this browser.” The handoff broker no longer silently enrolls a device after password/recovery unlock. Existing consented device wraps remain usable.
- Tests verify lock versus an unfinished handoff, refusal to persist product/ARK keys, in-memory ARK clearing/account switch, and opt-in device-envelope creation. The full suite passed all 15 workspaces: **446 tests** (324 Drive, 52 Accounts, 9 Photos app, 61 shared packages). Root typecheck passed 16/16 workspaces; Accounts, Photos and crypto-react lint, scoped Drive lint and package boundaries passed.
- Usability tradeoff: without browser trust, a full reload or cross-origin product navigation can require another local Vault unlock. Legacy IndexedDB deletion is best-effort when another old tab holds the database open. Do not claim remote erasure of usable keys already held by an offline or compromised browser.

## 0F — Direct Accounts API second-factor boundary

- A shared Accounts API guard rejects an OAuth session still awaiting its local second factor, including direct calls that never render an Accounts page. A consented, valid trusted-browser token can complete the step-up using the adapter-correct session update from 0D.
- All 29 sensitive handlers across Vault, passkey, device, key-handoff, product-session, Space-key, onboarding and profile routes call this guard before their existing data operations. Cookie-authenticated mutations additionally require the exact Accounts origin. Vault reads retain their old-client compatibility response before the auth check.
- The native Better Auth POST wrapper denies account-state mutations and OIDC consent for pending OAuth sessions. Sign-in, sign-up, second-factor verification, password recovery, token exchange and sign-out remain available so users can complete authentication or leave. Its trusted-browser path checks the origin before changing session state.
- Direct-route regression tests exercise every guarded handler, the native wrapper, origin rejection, trusted continuation and verified sessions. The existing real-adapter passkey test now checks that pending OAuth access fails before the verified session enrolls a passkey.
- Final validation: all 15 test workspaces passed, **480 tests** (324 Drive, 86 Accounts, 9 Photos app, 61 shared packages). Root typecheck passed all 16 workspaces; Accounts lint and package boundaries passed. No live account or external OAuth provider was exercised.
- F04 is only partially addressed: recent-auth policy for all security changes, native GET endpoint review, native issuer-session revocation convergence, rate limits on custom endpoints and end-to-end browser/provider checks remain.

## 0G — Issuer-session revocation convergence

- Better Auth's session-delete hook now revokes active Drive/Photos ProductSessions bound to the deleted issuer session before single or bulk browser-session deletion. The hook also covers internal deletion paths such as account-wide revocation; existing custom logout flows remain able to revoke orphaned product sessions when a browser session is already absent.
- Native `/api/auth/sign-out` checks the Accounts origin and revokes its current issuer's product sessions before delegating to Better Auth. This preflight is necessary because the installed Better Auth sign-out endpoint catches session-deletion errors and still clears the browser cookie; a failed product-session database write must stop that route before sign-out proceeds.
- Product-session updates re-check account/issuer scope, active state and expiry when writing, so concurrent revocations increment each session version at most once. Realtime revocation events remain best-effort; Drive and Photos authorization reads the durable `ProductSession` row.
- Disposable Mongo integration tests exercise adapter-created session IDs, single and bulk Better Auth deletion hooks, Drive/Photos scope isolation, and concurrent revocation. Direct-route tests cover native sign-out ordering, foreign-origin rejection and failure before cookie clearing.
- Final validation: all 15 test workspaces passed, **486 tests** (324 Drive, 92 Accounts, 9 Photos app, 61 shared packages). Root typecheck passed all 16 workspaces; Accounts lint and package boundaries passed. No live browser session or Redis publisher was exercised.
- F04 still needs recent-auth policy consistency, native GET endpoint review, custom endpoint rate limits and browser/provider end-to-end checks. Raw database deletion outside Better Auth hooks is outside this path; operational reconciliation remains a separate lifecycle concern.

## 0H — Referenced upload-key collision and multipart bounds

- Drive's generic single and multipart presign routes now query the shared cross-product ciphertext-reference repository before signing. They deny a requested main, thumbnail or chunk key already referenced by a Drive or Photos object, including Bin entries and retained versions. This stops a caller from obtaining a new generic PUT URL for a known live ciphertext key.
- Both routes require a positive safe-integer byte count. Multipart requires a safe-integer chunk count from 1 to 4096 and, when supplied, a 2–64 MiB integer chunk size. Rejection occurs before any presigned URL is created.
- Direct route tests cover a binned Photos key, a referenced Drive chunk, malformed/excessive counts and sizes, and successful fresh single/chunked uploads.
- Final validation: all 15 test workspaces passed, **495 tests** (333 Drive, 92 Accounts, 9 Photos app, 61 shared packages). Root typecheck passed all 16 workspaces; scoped Drive lint and package boundaries passed.
- This is a partial F08 fix. The protocol still accepts caller-selected new keys, allows pending-upload re-presign without an upload token, and does not prevent reuse of an already-issued URL before it expires. Server-owned opaque keys, reservation-bound resume and immutable completed content remain required. Ciphertext and personal metadata-format enforcement, plus complete-upload ownership checks, remain open. Existing presigned URLs are unaffected until their expiration.

## 0I — Pending upload reservations

- Generic single and multipart presign now create an upload ledger reservation before signing any PUT URL. A duplicate key fails closed. A refresh must present the returned `sessionId` and match its pending, unexpired bucket, key and account. Secondary thumbnails and optimized blobs must present both the parent's key and reservation ID; invalid parents no longer create an unrelated fallback ledger.
- The browser's live refresh and persisted-byte resume paths now send reservation IDs. A thumbnail uses the server-returned key, and the API reference documents the request/response contract. The ledger queries also reject keys already listed by another upload session; a bucket/key multikey index supports those lookups.
- Direct-route tests cover missing, wrong-owner, completed and parent reservation denials; fresh and valid refresh paths; overlapping in-flight keys; and concurrent attempts to reserve the same logical key. Existing orphan-cleanup tests now assert that completed sessions cannot accept new secondary keys.
- Final validation: all 15 test workspaces passed, **499 tests** (337 Drive, 92 Accounts, 9 Photos app, 61 shared packages). Root typecheck passed all 16 workspaces; scoped Drive lint passed with six pre-existing unused-value warnings, and package boundaries passed. The OpenAPI JSON parsed successfully.
- This still relies on the existing unique `(bucketId, fileId)` index for atomic logical-key reservation. Overlapping secondary keys under different logical file IDs have an application-level conflict check but no unique physical-key claim, so concurrent cross-key races remain possible. A server-owned opaque-key format and atomic physical-key claim are the next F08 boundary. Completion must also bind metadata to the reservation, and presigned URLs issued before completion can be reused until they expire. Older persisted upload journals missing a reservation ID may need their upload restarted; deploy the route and browser change together.

## 0J — Atomic physical-key claims and development policy

- `AGENTS.md` now records the user's development-only decision: there are no real users or production records to preserve, so future work should implement the secure target contract directly and remove obsolete paths after callers move.
- UploadSession now has a unique multikey `(bucketId, keys)` claim index. Presign code explicitly ensures that index before reserving or attaching keys and fails closed if an older non-unique development index exists. The previous overlap lookup remains a fast conflict check; the unique index makes concurrent claims across different logical file IDs atomic. Duplicate-key conflicts return a reservation denial before any URL is signed.
- Synthetic Mongo tests race two different logical uploads claiming one physical key and two parents attaching one secondary key. Exactly one claim wins in each case, and the index's unique property is asserted.
- Final validation: all 15 test workspaces passed, **501 tests** (339 Drive, 92 Accounts, 9 Photos app, 61 shared packages). Root typecheck passed all 16 workspaces; scoped Drive lint and package boundaries passed.
- Existing development databases with the non-unique index should be reset/reseeded for this schema. Server-issued opaque object keys, completion-bound claims and post-completion URL replay protection remain F08 work.

## 0K — Server-issued Drive upload identities

- Generic single and multipart presign now append a server-generated 32-character random hex identity to an authorized destination prefix. Caller `fileName` no longer controls any new physical B2 key. A refresh resolves the existing key from the authenticated pending reservation instead of trusting a supplied name. Multipart refresh also checks that the reserved chunk count is unchanged.
- A reserved parent controls its deterministic `-thumb` and `-optimized` variant keys through `parentSessionId` plus a constrained variant purpose. The Drive upload client no longer sends main filenames for presigning; thumbnail and optimized paths use the returned key. OpenAPI describes the new request contract.
- Direct-route tests verify that a known Photos key or chunk name cannot be targeted through `fileName`, fresh requests with the same supplied name receive different keys, and reservation refreshes return the original key even if a different name is supplied.
- Final validation: all 15 test workspaces passed, **501 tests** (339 Drive, 92 Accounts, 9 Photos app, 61 shared packages). Root typecheck passed all 16 workspaces; scoped Drive lint passed with four pre-existing unused-value warnings, package boundaries passed, and OpenAPI JSON parsed.
- This does not yet remove folder prefixes from physical keys, bind completion to a reservation, prove encrypted personal metadata, or prevent reuse of an already-issued PUT URL after completion. The standalone share-thumbnail flow has a separate retention/lifecycle problem and remains for a dedicated fix; this change does not make that upload path succeed.

## 0L — Space-bound upload completion

- Upload reservations now record their Space. New and refreshed presign requests and secondary-key attachments must stay in that same Space. Generic completion requires the exact pending, unexpired reservation for its account, Space, bucket and server-issued object key before reading B2 or changing metadata.
- Every B2 key named by completion—main, chunks, optimized variant and stored thumbnail—must be claimed by that reservation. Generic completion no longer overwrites an existing StorageObject; the dedicated revision flow owns content updates. A duplicate-key race on object creation also returns a conflict without deleting the winning blob.
- New Drive objects are explicitly product-owned and require encrypted key/name fields. Successful completion marks only the matching reservation completed; a second attempt cannot re-meter the object. The browser sends its reservation ID in live and resumed completion requests, and the API reference describes the contract.
- Content-fingerprint dedup queries now stay inside the same Drive Space/product, avoiding a cross-product or cross-Space match during completion.
- Direct-route tests cover wrong account/Space, missing reservation, unclaimed variant, existing-object conflict, successful encrypted completion and repeat denial. The quota rollback test retains a real synthetic reservation; its former generic-overwrite expectations now assert conflict and unchanged billing.
- Final validation: all 15 test workspaces passed, **505 tests** (343 Drive, 92 Accounts, 9 Photos app, 61 shared packages). Root typecheck passed all 16 workspaces; scoped Drive lint passed with six pre-existing unused-value warnings, package boundaries passed, and OpenAPI JSON parsed. Development databases need a reset/reseed for the new required UploadSession Space field.
- The post-upload metadata, metering and reservation-state writes are still not one durable transaction. A process crash between them needs reconciliation, and a presigned URL may remain usable until expiry after completion. F11 quota/physical-byte verification and folder-prefix confidentiality also remain open.

## 0M — Photos destructive-cleanup containment

- Photos completion compensates only the `PhotoAsset` row tied to the StorageObject ID created by that request. A losing completion can no longer delete another request's winning asset with the same `assetId`.
- Completion no longer deletes caller-submitted B2 keys on a size mismatch, duplicate/incomplete metadata, quota denial or uncertain write failure. Existing-asset retries return the asset without touching alternate uploaded keys. The unsafe Photos abort endpoint fails closed until a server-owned upload manifest can prove exact key ownership; the browser no longer calls it. The unused rolling-deployment presign aliases were removed under the development-only policy.
- Disposable Mongo race tests force a winner to appear after a losing request's initial lookup and assert that its asset and ciphertext record survive. They also cover response-lost retry, size mismatch without B2 deletion and refusal to abort an arbitrary shared-bucket key.
- Final validation: all 15 test workspaces passed, **509 tests** (343 Drive, 92 Accounts, 13 Photos app, 61 shared packages). Root typecheck passed all 16 workspaces; Photos lint and package boundaries passed. The new Photos integration tests use a disposable Mongo replica set.
- This contains the immediate F12/F13 data-loss path but can leave abandoned ciphertext in B2. The next Photos phase needs a durable presign manifest, transaction-scoped metadata/usage writes and a reference-aware orphan reconciler. It must never infer deletion ownership merely from an account key prefix.

## 0N — Photos upload manifests

- Presign now requires the client-generated asset ID and writes a server-owned `PhotoUpload` manifest with exact original/optimized/thumbnail keys, sizes, account, Space, bucket and expiry before signing B2 URLs. Re-presigning the same pending asset reuses its keys; a completed or incompatible manifest is rejected.
- Completion requires `uploadId` and verifies every key and size against the manifest before B2 HEADs. A conditional pending-to-completing claim prevents simultaneous completion or abort from using the same upload. Successful completion marks the manifest completed; quota denial and caught failures release the claim for retry.
- Abort accepts only `uploadId`, claims the manifest, checks shared Drive/Photos StorageObject references, and deletes only its reserved keys. B2 transport and per-key errors leave it retryable in `aborting` state; completed uploads cannot be aborted. The browser sends the ID through presign, completion and abort.
- Disposable Mongo tests cover stable presign identities, manifest mismatch, successful completion, response-lost retry, a losing asset-ID race, and exact-key abort that cannot delete a supplied Drive key.
- Final validation: all 15 test workspaces passed, **513 tests** (343 Drive, 92 Accounts, 17 Photos app, 61 shared packages). The final Photos rerun passed all 17 tests, including concurrent presign and completion. Root typecheck, Photos/database lint and package boundaries passed. The new API contract is recorded in `15-photos-upload-contract.md`.
- Expired pending and interrupted `completing` manifests still need an authenticated cron reconciler. Metadata, Usage, bucket counters and manifest completion are not yet one database transaction. A referenced manifest that reaches abort currently remains blocked for operator review rather than risking deletion.

## 0O — Leased Photos orphan cleanup

- Client abort and cron now use one manifest-owned cleanup service. It takes a five-minute conditional lease, confirms exact-key B2 deletion, checks every product/retained StorageObject reference and retains retry state on transport or per-key failure. Referenced manifests become `blocked` and are excluded from destructive cleanup.
- The authenticated Photos HTTP cron handles one bounded batch of 100 expired pending/aborting/aborted manifests. Confirmed deletion precedes removal of the ledger. Aborted manifests remain until the grace window expires, then their keys are checked/deleted again to reclaim bytes replayed through an old PUT URL. Presign renews that grace window whenever it issues URLs.
- `apps/photos/vercel.json` registers the hourly schedule for a Photos-root deployment. Tests authenticate the route, verify exact manifests, protect a Drive reference, retain per-key deletion failures, retry them, enforce one concurrent cleanup lease and recheck aborted keys after expiry.
- Final validation: all 15 test workspaces passed, **520 tests** (343 Drive, 92 Accounts, 24 Photos app, 61 shared packages). Root typecheck passed all 16 workspaces; Photos/database lint, package boundaries and Photos cron JSON parsing passed.
- Interrupted `completing` and completed manifests are not automatically deleted. Transactional finalization and a read-only/durable reconciler for interrupted or blocked records remain required; no live B2 delete or deployed cron was executed.

## 0P — Transactional Photos finalization

- A shared `@xenode/database` repository now atomically claims the pending Photos manifest, creates its StorageObject/PhotoAsset, increments Usage and bucket counters and marks completion in one Mongo transaction. The StorageObject ID is the manifest ID, making the completed asset relationship exact. The app route verifies B2 lengths then delegates the database commit.
- The transaction helper explicitly uses snapshot reads, primary routing and majority commit. A replica set is required; no non-transactional fallback or compensating multi-delete branch remains. Quota, duplicate identity or missing bucket failure leaves all writes unchanged and the manifest pending.
- A retry returns only the asset belonging to the exact completed manifest, without repeating B2 reads or metering. A conflicting asset ID returns 409 instead of returning unrelated upload metadata. Concurrent completion is committed once; abort winning before commit prevents finalization.
- Disposable Mongo tests cover quota failure, bucket disappearance after metadata writes begin, conflicting asset IDs, concurrent completion, response-lost retry and abort during B2 verification. B2 PUT replay/immutability and review of blocked cleanup records remain separate storage work. Disposable records from prior development phases can be reset rather than migrated.
- Final validation: all 15 test workspaces passed, **523 tests** (343 Drive, 92 Accounts, 27 Photos app, 61 shared packages). Root typecheck, Photos/database lint and package boundaries passed. `docker-compose.mongo.yaml` configuration validated; README and example URIs now require the replica set. No development database was started/reset and no live B2 or scheduler was exercised.

## 0Q — Verified transactional Drive finalization

- Generic Drive completion now HEADs every selected main/chunk/optimized/thumbnail blob, checks safe integer ciphertext lengths and rejects malformed chunk indices, keys, counts, totals and IV layouts. Optional variant size assertions must match; actual derivative sizes are always persisted and metered. A missing declared variant prevents completion.
- UploadSession is a shared database model. A shared snapshot/majority transaction creates the manifest-ID StorageObject, charges the authoritative personal/org Space owner, updates bucket counters and completes the reservation together. Initialized Usage/OrgUsage is required; finalization does not create plan state or mutate expired plans.
- Concurrent and response-lost completion converge to the exact object with one counter update. Fingerprint/key conflicts and quota/bucket failures preserve pending reservations without B2 deletes. Realtime publication runs after commit and cannot turn committed metadata into a failure.
- Manual/cron Bin purge and personal recalculation include thumbnail/optimized bytes and skip version entries sharing current content. Personal recalculation counts both products in the shared Space. New Drive model records require a product identity and default to Drive; disposable development records can be reset. Live/resumed browser completion sends B2 thumbnail keys only and omits optimized size assertions when that variant was not uploaded.
- Twenty-three new disposable Mongo regression cases cover byte mismatch, variant accounting and quota, missing quota state/bucket, authoritative organization metering, concurrent completion and quota races, fingerprint conflicts, chunk layout and per-chunk lengths, missing variants, plan-state preservation and cross-product recalculation. Existing purge and completion tests now assert the updated byte/idempotency contract. OpenAPI and `16-drive-upload-contract.md` document it.
- Final validation: all 15 test workspaces passed, **546 tests** (366 Drive, 92 Accounts, 27 Photos app, 61 shared packages), verified in the completed workspace test logs after the shell session was lost. Root typecheck passed 16/16; scoped Drive lint passed with four pre-existing unused-value warnings in UploadContext, database lint and package boundaries passed; OpenAPI JSON and Git whitespace checks passed. No live B2, development database reset or deployed scheduler was exercised.
- F11 remains open for dedicated organization/revision paths and durable purge accounting. Drive orphan cleanup still needs leased claims, completed-unused-key reconciliation and serialization with finalization/renewal. B2 PUT replay, opaque folder-free keys and browser journal crypto/Space completeness remain separate work.

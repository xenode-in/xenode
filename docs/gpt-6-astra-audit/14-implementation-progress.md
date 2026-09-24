# Incremental remediation progress

The audit is a snapshot of the pre-remediation working tree. Findings are not closed merely because one supporting fix lands.

## Decisions

- The user selected a **separate Vault password, entered locally only**, for F01. Preserve existing ARKs and file access during migration; never send the new Vault password through Better Auth or server unlock verification.
- Commit each completed implementation increment, including regression tests and its validation record.
- Preserve pre-existing Accounts/UI work separately from remediation. It was checkpointed unchanged as `f928e94` before the overlapping Vault migration; this is a baseline commit, not a claim that its audited issues were fixed.

## Phase 0 increments

| Increment | Scope | Status |
| --- | --- | --- |
| 0A | Confirm storage deletion, protect retained references during orphan cleanup, enumerate chunked purge content | Complete; see validation below |
| 0B | Enforce action permissions on generic storage mutations | Complete; full test suite passed |
| 0C | Separate local Vault password and migrate existing envelopes without changing root keys | Committed as `dae2945`; rollout notes below |
| 0D | Normalize Better Auth Mongo IDs for passkey and second-factor records | Complete; full suite passed |

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

- A shared `@xenode/database` repository maps Better Auth's external string IDs to raw Mongo `_id` and `userId` fields. Passkey lookup/listing now uses this repository and checks both account and credential ID. Both native ObjectId and historical string IDs remain readable.
- The combined passkey binding route now finds actual adapter-created passkeys. A duplicate binding request can no longer delete the first request's winning binding during compensation. Reading a Vault passkey envelope also checks that its native passkey is still registered.
- OAuth second-factor verification and trusted-device continuation update the actual native session row, require the current account/session pair and an unexpired session, and fail closed if that write cannot be confirmed.
- Eight disposable Mongo integration tests create users, sessions and passkeys through the installed Better Auth adapter. They cover owner and credential isolation, duplicate binding, both TOTP/backup route branches with mocked code verification, trusted-device persistence, missing/expired sessions and historical string IDs. Real WebAuthn and authenticator ceremonies are still a later integration gate.
- Targeted integration tests pass (8/8). Full `npm run test -- --force` passed all 15 workspaces: **441 tests** (324 Drive, 49 Accounts, 9 Photos app, 59 packages). Root typecheck passed 16/16 workspaces. Accounts/database lint and package boundaries pass.

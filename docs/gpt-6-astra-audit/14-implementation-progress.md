# Incremental remediation progress

The audit is a snapshot of the pre-remediation working tree. Findings are not closed merely because one supporting fix lands.

## Decisions

- The user selected a **separate Vault password, entered locally only**, for F01. Preserve existing ARKs and file access during migration; never send the new Vault password through Better Auth or server unlock verification.
- Commit each completed implementation increment, including regression tests and its validation record.
- Preserve pre-existing uncommitted Accounts/UI work. Stage only files belonging to the audit/remediation increment.

## Phase 0 increments

| Increment | Scope | Status |
| --- | --- | --- |
| 0A | Confirm storage deletion, protect retained references during orphan cleanup, enumerate chunked purge content | Complete; see validation below |
| 0B | Enforce action permissions on generic storage mutations | Complete; full test suite passed |
| 0C | Separate local Vault password and migrate existing envelopes without changing root keys | Pending; user decision recorded |

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

- Drive access-context resolution accepts an explicit action and delegates role enforcement to `@xenode/spaces`. Generic presign, completion, legacy upload, reorder, metadata, restore and object PATCH require write access; purge requires delete access. Bucket action checking is no longer ignored.
- Photos asset projection and album creation assert write permission after Space resolution. Guest denials return 403 before repository/storage mutations.
- Direct API regressions cover ten Drive mutation paths, guest reads, member writes and forbidden member deletion, plus guest/member Photos flows. Existing object state is checked after denial and successful member reorder.
- Corrected stale Drive session-resolution fixtures to create an onboarded profile, encrypted Vault envelopes and a credential record. Added four missing-onboarding negative cases without relaxing the production resolver.
- Scoped Drive and Photos ESLint pass; removed four existing `any` escapes in touched route error handling. Root typecheck passed 16 workspaces and the final Drive typecheck passed; Photos lint and boundary checks passed.
- Targeted validation: 26 Drive tests, 9 Photos tests, a final 12-test permission rerun, and 7 session-resolution tests passed. The first full-suite run retained only the two known stale-fixture failures. After repairing those fixtures, the final full suite passed all 15 test workspaces: **418 tests**, including 324 Drive tests.
- Remaining: upload identity/key ownership (F08/F13), complete endpoint-wide tenant audit, and the other Phase 0 findings are not claimed fixed by these role checks.

## Next: 0C — Separate local Vault secret

User choice is recorded above. The implementation must distinguish login credentials from Vault unlock/change credentials, remove Vault-password transmission from server confirmation, and provide an explicit local rewrap migration for existing envelopes. Rewrapping must preserve the existing ARK/file access; it cannot revoke a root key already learned by a previously compromised server. Recovery, passkeys and trusted-device flows need compatibility tests before this increment can be marked complete.

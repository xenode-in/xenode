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
| 0B | Enforce action permissions on generic storage mutations | Pending |
| 0C | Separate local Vault password and migrate existing envelopes without changing root keys | Pending; user decision recorded |

The rest of the roadmap remains open. F09/F10 also require durable claim/reconciliation across concurrent finalize/restore/purge operations; a deletion confirmation patch alone is not complete lifecycle safety.

## 0A — Storage deletion safeguards

- Bulk S3 deletion now propagates transport failures and rejects per-key errors, including HTTP-success responses containing failures.
- Orphan cleanup uses exact ledger keys and a shared cross-product reference repository covering current chunks, thumbnails, optimized variants, retained versions and Bin objects. Missing bucket metadata or deletion failure retains the ledger.
- Bin purge includes current chunk blobs and fails before deletion when bucket/Space-owner metadata is missing. Personal counters use the Space owner; organization/team counters use OrgUsage. Manual purge deduplicates overlapping selections.
- Regression validation: 36 tests passed across storage deletion, Bin/orphan safety, org governance and version metering. Root typecheck passed all 16 workspaces; boundary check and database lint passed. Changed Drive files passed scoped ESLint with two pre-existing unused-parameter warnings in the orphan test mock.
- The first test run found a test-hook issue: returning a mock from beforeEach registered it as cleanup. Corrected the test hook; the expanded run passed.
- Remaining F09/F10 work: durable deletion claims/reconciliation, concurrent restore/finalize exclusion, cross-object retained-reference protection during purge, and fully atomic metadata/metering effects. No live cron or storage deletion was executed.

# Incremental remediation progress

The audit is a snapshot of the pre-remediation working tree. Findings are not closed merely because one supporting fix lands.

## Decisions

- The user selected a **separate Vault password, entered locally only**, for F01. Preserve existing ARKs and file access during migration; never send the new Vault password through Better Auth or server unlock verification.
- Commit each completed implementation increment, including regression tests and its validation record.
- Preserve pre-existing uncommitted Accounts/UI work. Stage only files belonging to the audit/remediation increment.

## Phase 0 increments

| Increment | Scope | Status |
| --- | --- | --- |
| 0A | Confirm storage deletion, protect retained references during orphan cleanup, enumerate chunked purge content | In progress |
| 0B | Enforce action permissions on generic storage mutations | Pending |
| 0C | Separate local Vault password and migrate existing envelopes without changing root keys | Pending; user decision recorded |

The rest of the roadmap remains open. F09/F10 also require durable claim/reconciliation across concurrent finalize/restore/purge operations; a deletion confirmation patch alone is not complete lifecycle safety.

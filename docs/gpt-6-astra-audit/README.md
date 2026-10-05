# Xenode repository and refactor audit

Audit date: **2026-09-17**. Baseline: **`3c863e5` plus the existing working-tree changes**. This is an implementation audit and continuation plan, not a production security certification.

Start with [the executive summary](00-executive-summary.md), then [the migration map](02-refactor-status.md) and [the roadmap](11-refactor-roadmap.md). [The findings register](12-findings-register.md) contains the evidence, impact, architecture classification, and recommended action for each significant finding.

| Document | Purpose |
| --- | --- |
| [00 — Executive summary](00-executive-summary.md) | Current state, release blockers, priorities |
| [01 — Current architecture](01-current-architecture.md) | Applications, packages, data, execution paths |
| [02 — Refactor status](02-refactor-status.md) | Old → transitional → intended architecture |
| [03 — Accounts](03-accounts-audit.md) | Identity, Vault, devices, recovery, sessions |
| [04 — Drive](04-drive-audit.md) | Complete file lifecycle, sharing, quotas, trash |
| [05 — Photos](05-photos-audit.md) | Independent product, derivatives, library, incomplete features |
| [06 — E2EE security](06-e2ee-security-audit.md) | Trust diagram, keys, plaintext and metadata boundaries |
| [07 — Shared platform](07-shared-platform-architecture.md) | Canonical modules and incremental extraction |
| [08 — Technical debt](08-technical-debt.md) | Concrete duplication, performance and maintenance issues |
| [09 — Missing and broken](09-missing-and-broken.md) | Feature classification and evidence |
| [10 — Testing and production](10-testing-production-readiness.md) | Executed checks, coverage gaps, deployment safety |
| [11 — Roadmap](11-refactor-roadmap.md) | Ordered work with acceptance criteria |
| [12 — Findings register](12-findings-register.md) | Stable finding IDs and reproducible source traces |
| [13 — Evidence and inventory](13-evidence-and-inventory.md) | Scope, source inventory, validation record and limitations |
| [14 — Implementation progress](14-implementation-progress.md) | Remediation increments, decisions and validation |
| [15 — Photos upload contract](15-photos-upload-contract.md) | Manifest, transactional completion and cleanup |
| [16 — Drive upload contract](16-drive-upload-contract.md) | B2 byte verification, transactional quota and retries |
| [17 — Drive revision contract](17-drive-revision-contract.md) | Direct ciphertext saves, concurrency and retained bytes |
| [18 — Drive Bin contract](18-drive-bin-contract.md) | Purge intent, restore fencing, leases and atomic quota retirement |
| [19 — Parent retirement contract](19-parent-retirement-contract.md) | Team/organization retirement through per-object purge |
| [20 — Share reference retirement](20-share-reference-retirement.md) | Public bundle and album-share pruning during purge |
| [21 — B2 physical version deletion](21-b2-physical-version-deletion.md) | Historical; superseded by the R2 contract |
| [22 — R2 S3 contract](22-r2-s3-contract.md) | R2 endpoints, exact deletion and confirmation |
| [23 — R2 write-once upload](23-r2-write-once-upload.md) | Create-only signed ciphertext PUTs |
| [24 — Photos abort lifecycle](24-photos-abort-lifecycle.md) | Cancellation that honors signed PUT expiry |
| [25 — Vault bootstrap contract](25-vault-bootstrap-contract.md) | Atomic Accounts hierarchy creation and exact retries |
| [26 — Admin session contract](26-admin-session-contract.md) | Current operator authority and versioned JWT revocation |
| [27 — Finding status](27-finding-status.md) | Evidence-backed status of every finding and open release gate |
| [28 — Second-factor contract](28-second-factor-contract.md) | Pending sessions, step-up lockout and the OIDC code gate |
| [29 — Accounts sensitive actions](29-accounts-sensitive-actions.md) | Recent authentication, rate limits and revocation semantics |
| [30 — Realtime contract](30-realtime-contract.md) | Ticket binding, handshake Origin gate and connection lifetime |
| [31 — Drive folder model](31-drive-folder-model.md) | Immutable physical keys, metadata folders, move, Bin batches |
| [32 — Workspace keyring](32-workspace-keyring.md) | Versioned workspace key grants, rotation and new keyholders |
| [33 — Product origins](33-product-origin-contract.md) | Exact configured web origins, OAuth allowlists and build inputs |
| [34 — Storage usage reconciliation](34-storage-usage-reconciliation.md) | Read-only snapshot reports for organization and personal counters |
| [35 — File format](35-file-content-format.md) | AAD-bound chunks, file-key wraps and metadata keyed to the object id |
| [36 — Storage pool provisioning](36-storage-pool-provisioning.md) | Explicit enabled pools, verified bucket mappings and immutable selection |

## Reading the judgments

- **CRITICAL**: defeats the central confidentiality boundary or has comparable impact.
- **HIGH**: concrete authorization, data integrity, availability, or release-blocking problem.
- **MEDIUM**: bounded correctness/privacy/reliability issue or consequential migration gap.
- **LOW**: limited maintenance or presentation impact.
- **KEEP / FIX / MIGRATE / REPLACE / REMOVE / INVESTIGATE** describe the recommended action, not severity.
- **Confirmed source behavior** means the execution path was inspected. **Reproduced** means an indicated check ran. **Conditional** means impact depends on configuration, existing data, or deployment. **Not verified** is not a passing result.

Paths in the reports are repository-relative unless explicitly identified as installed dependency source. Findings apply to the audited working tree; uncommitted features are not represented as already merged. No application implementation, migrations, dependencies, or deployment configuration were changed during this audit. No live database migrations, billing actions, or destructive storage operations were performed.

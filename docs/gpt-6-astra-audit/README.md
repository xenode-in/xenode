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

## Reading the judgments

- **CRITICAL**: defeats the central confidentiality boundary or has comparable impact.
- **HIGH**: concrete authorization, data integrity, availability, or release-blocking problem.
- **MEDIUM**: bounded correctness/privacy/reliability issue or consequential migration gap.
- **LOW**: limited maintenance or presentation impact.
- **KEEP / FIX / MIGRATE / REPLACE / REMOVE / INVESTIGATE** describe the recommended action, not severity.
- **Confirmed source behavior** means the execution path was inspected. **Reproduced** means an indicated check ran. **Conditional** means impact depends on configuration, existing data, or deployment. **Not verified** is not a passing result.

Paths in the reports are repository-relative unless explicitly identified as installed dependency source. Findings apply to the audited working tree; uncommitted features are not represented as already merged. No application implementation, migrations, dependencies, or deployment configuration were changed during this audit. No live database migrations, billing actions, or destructive storage operations were performed.

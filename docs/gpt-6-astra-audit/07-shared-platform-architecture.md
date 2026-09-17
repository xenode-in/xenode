# Shared platform boundaries

The platform direction is sound. The next step should be to complete existing seams, not introduce a package for every noun in the product roadmap.

## Canonical ownership decisions

| Concern | Canonical owner | Recommendation and evidence |
| --- | --- | --- |
| Authentication authority | Accounts + Better Auth | **KEEP**; Drive/Photos are OIDC clients, admin is separate |
| OIDC/client cookies | `identity-core` + small per-app adapters | **KEEP / MIGRATE** common callback orchestration to eliminate duplicated validation; retain explicit product IDs/origins |
| Vault and recovery ceremony | Accounts browser | **REPLACE** secret coupling; **KEEP** `crypto-core` primitives |
| Envelopes and crypto versions | `crypto-core` | **MIGRATE** reusable file/variant wraps from Photos/Drive behind explicit versioned formats; no silent reinterpretation |
| Product key lifecycle | `crypto-react` | **FIX** memory-only state and cancellation generations; Accounts device trust remains a separate consented mechanism |
| Space access/roles | `spaces` | **KEEP / FIX** require action in the entry point so callers cannot omit it |
| Database connections | `database` | **KEEP**; wrappers are acceptable, duplicate clients are not |
| Storage metadata and upload ownership | Shared server repository, building on `database` | **MIGRATE** Drive StorageObject/Bucket schema and Photos raw writes into one product/Space-aware seam |
| Object storage transport | Shared server storage adapter | **MIGRATE** regional client, signing, HEAD verification, deletion outcomes and manifest ledger; keep bytes browser-direct |
| Browser upload orchestration | `upload-engine` with concrete adapters | **KEEP / MIGRATE** retry/journal/crypto transport out of UI; Photos policy remains product-specific |
| Media transforms | `media-processing` | **MIGRATE** reusable bounded worker work, EXIF/date handling, faststart and derivative specs; avoid importing Drive |
| Photos projections/albums | `photos` | **KEEP** product domain; do not force Drive's folder representation into albums |
| Sharing grants | Initially Drive module, then shared grants contract | **KEEP / MIGRATE** only after role/key semantics and product ownership are explicit; Photos must implement a real adapter |
| Metering | Shared storage usage operations | **MIGRATE** byte accounting for all variants/products; billing changes consume counters only |
| Plan/subscription state | Current Drive billing service | **KEEP / FIX** `syncUserSubscriptionState` single-writer boundary; postpone packaging until stable |
| Realtime | `realtime`, separately deployed host eventually | **KEEP / MIGRATE** shared verifier into Node host with exact-origin checks and session expiry |
| Local sync/search | Small browser file-runtime module | **FIX** tuple cursors, account/Space partitions, tombstones; keep plaintext indexes local |
| Jobs | Authenticated HTTP cron + durable work records | **KEEP / FIX** scheduler consistency and retry state; no need for a queue service solely to rename cron |
| Telemetry | Shared sanitized event/log policy | **MIGRATE** allowlists and redaction without collecting plaintext filenames/content |
| UI | `ui` for primitives; apps for workflows | **KEEP** shared controls, migrate Drive duplicates gradually |

## A concrete next storage contract

**MIGRATE** toward an upload record containing account, product, Space, physical region/bucket, server-issued upload ID, generated variant keys, expected ciphertext lengths, expiry and state. Only this record may authorize finalization or cleanup. Finalization verifies storage lengths, records the agreed crypto format and atomically claims the metadata/quota effect. Cleanup records per-key success and retries failed keys; it never accepts arbitrary prefixes as proof of ownership.

The contract should explicitly separate `authorizeUpload`, `reserveUsage`, `signVariant`, `verifyVariant`, `commitUpload`, `abortUpload` and `purgeObject`. It should not return plaintext or own browser keys. Keep the state machine in shared server code and the product transformation policy in a product adapter.

This addresses real divergence: Drive has a persistent UploadSession but trusts byte reports; Photos verifies lengths but has no durable ledger and dangerous rollback. Neither implementation should simply replace the other unchanged.

## Crypto compatibility strategy

**MIGRATE** through explicit read adapters for: Drive RSA-wrapped personal DEKs, Drive AES Space-wrapped DEKs, Photos AAD-bound variants, versioned metadata strings and legacy key-included strings. New writes should use one canonical format with account/product/Space/object/version/purpose binding. Keep each old read path until client-assisted rewrap/re-encryption has been verified and inventoried. A server cannot transform private metadata or rewrap unknown keys by itself.

For workspace rotation, **FIX** historical-key retrieval for authorized current members or complete a client-assisted rewrap before retiring old grants. Removing a member's ability to obtain new keys does not make existing bytes decryptable by remaining members under a new key automatically.

## Dependency discipline

The boundary script passes, but checks source imports, selected framework/server restrictions and cycles. It does not prove semantic isolation in a shared Mongo collection or S3 bucket. **FIX** that gap with repository-level product/Space/action tests; do not interpret a green import graph as a green tenant boundary.

`database/target.ts` mixes identity, session, Vault and Photos models; splitting by domain is a **LOW / MIGRATE** maintenance task, secondary to safe lifecycle semantics. Drive's 1,900-line UploadContext and 2,400-line preview/browser components should be extracted along testable domain operations, not arbitrary file-size thresholds.

## Future products and local AI

**KEEP** the product registry/Space/envelope approach for future products. There are currently no Mail/Calendar/Notes/Tasks/Contacts/Messages workspaces to migrate. Do not manufacture a completion percentage for them.

**KEEP** `v2_ml_plan.md` as design intent: local inference and encrypted metadata/index storage fit the privacy goal. Before implementation, **INVESTIGATE** device compute budgets and encrypted index sync. If cloud processing is later added, its contract must require explicit, scoped consent before decrypted content crosses that boundary; no current runtime consent or inference implementation exists to reuse.

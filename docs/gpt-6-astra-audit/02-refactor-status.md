# Refactor reconstruction and migration map

Completion is qualitative and grounded in execution paths. A percentage would imply a defined denominator that the repository does not provide. “Mostly migrated” means the new path is active but important compatibility or correctness work remains.

## Historical sequence

| Git evidence | Observed direction |
| --- | --- |
| `85b112e` (2026-07-14), pre-monorepo tree | Single Next application owned auth, Vault, Drive, Photos/albums, billing and migration routes. `lib/crypto/keySetup.ts` wrapped RSA private material using PBKDF2-derived password/recovery keys. |
| `3be04c4` (2026-07-14) | Workspaces and transitional `platform-web`; structural separation began. |
| `ff23599`, `d8b8656`, `2dbe135` (2026-07-15) | Shared product/Space/security foundations and product-key normalization. |
| `837530a`, `ca75203` (July 15–17) | Realtime revocation and Space-scoped object hardening. |
| `c65547b`, `f6cb12a`, `775d7d8` (2026-07-18) | Drive OIDC authority cutover, Vault v2 handoff, workspace cleanup/Drive naming. |
| `b20ab4d`, `9bd7056`, `1bb1b61` (2026-07-25) | Product/ARK persistence and seamless unlock deliberately reintroduced durable usable keys. This is a design divergence, not an unnoticed leftover. |
| `0dca53f` through `1a0340b` (July 26–27) | Regional storage and pricing, explicit region propagation, org quotas. `20cc485` explicitly corrected AsyncLocalStorage propagation. |
| `40cfa71`, `5f21e8a`, `2e0408e` (July 27–28) | OIDC/session coordination, handoff strengthening, crypto context and upload queue integration. |
| `c2df694`, `3c863e5` (July 28–29) | Vault passkeys and device/session presentation. |
| Audited working tree | Combined Better Auth + Vault passkeys, OAuth 2FA trust, staged password change, profile/security UI, Photos Lightbox changes. These are not part of HEAD. |

History identifies direction; current code, not commit titles, determines the statuses below.

## Migration map

| Area | Old architecture | New / intended architecture | Current state | Completion | Problems | Required work |
| --- | --- | --- | --- | --- | --- | --- |
| Repository | One Next app | Independent apps + shared packages | Three apps and 15 packages actively imported | Mostly migrated | Infrastructure packaging lagged behind layout | **KEEP / FIX** Docker and CI release topology |
| User auth | Drive Better Auth | Accounts authority, OIDC product clients | Code exchange, JWT verification and signed host-only ProductSessions active | Mostly migrated | Duplicate callback adapters; custom Accounts API gates inconsistent | **KEEP / FIX** F03/F04 |
| Vault | PBKDF2/password/recovery RSA vault | Accounts Argon2id → ARK → product/Space hierarchy | Shared v2 envelopes and broker active | Implemented incorrectly at secret boundary | Same server-received password wraps ARK | **REPLACE** secret ceremony, F01 |
| Key lifetime | Device-local cached keys | Memory-only product keys | `crypto-react`, ARK and Drive auxiliary keys persist in IndexedDB | Diverged from intended constraint | Non-extractability confused with absence of usable keys at rest | **FIX** F02 |
| Device/passkeys | Drive PRF/passkey records | Accounts auth + Vault binding | Legacy Drive, Accounts VaultPasskey and new AccountPasskeyBinding coexist | Duplicated / partially migrated | Raw Mongo IDs; browser sessions are presented as devices | **MIGRATE / FIX** F03; preserve recovery paths |
| Password/recovery | Drive-specific flows | Accounts credential/envelope coordination | Recovery primitives; staged password rotation in working tree | Partial | 15-minute recovery window; native endpoint bypass; no complete lost-login recovery UI | **FIX** F05; finish recovery |
| Tenant boundary | User/bucket/org prefix checks | Space + product + role/action | Most Drive object filters use Space | Mostly migrated, with dangerous gaps | Generic writes/purge omit action checks; storage prefix grants bypass record ownership | **FIX** F07/F08/F13 |
| Database | App-local Mongoose models | Shared connection and owned repositories | Connection centralized; target models shared | Partial | Drive models remain local; Photos raw writes duplicate schema/accounting | **MIGRATE** storage seam after lifecycle fixes |
| Personal file crypto | RSA-wrapped file DEKs | Product key is primary product boundary; RSA subordinate to sharing | Personal Drive still uses RSA for ordinary uploads; metadata key derives from ProductSpaceKey | Transitional path still active | Product key alone does not describe Drive's content access | **MIGRATE** versioned DEK wraps without losing old reads |
| Org/team keys | Raw Space keys and RSA grants | Canonical product/Space keys with versioned access | Records normalized; old raw-key hook remains | Partial / rotation broken | Old versions retired; UI selects newest grant; no content rewrap | **FIX** F18 before further extraction |
| Uploads | Giant Drive context | Shared orchestration with product adapters | Shared queue adopted; transport/encryption/journal remain in Drive and Photos UI | Partial | Resume drops org wrapping fields; Photos no durable ledger | **MIGRATE / FIX** F12/F17 |
| Downloads | Signed Next/CDN proxy | Direct browser-storage ciphertext transfer | Drive proxy remains active; Photos direct GET | Duplicated / partial | Docs incorrectly claim no proxy | **MIGRATE** F19 |
| Media | Drive parser workers and transformations | Shared browser media pipeline | Shared package contains small helpers; separate Photos canvas path | Partial | EXIF/dates and video handling differ | **MIGRATE** reusable processing only |
| Photos ownership | Drive media views and PhotoAlbum | Photos-owned assets/album projections | Separate app and product key; old Drive album APIs still live | Partial | Projection can accept Drive object that content route rejects | **FIX / MIGRATE** F30 |
| Timeline | Drive gallery helpers | Large independent Photos library | Cursor backend active; all loaded tiles rendered | Partial | Window helper tested but unused | **FIX** F16 |
| Sharing | Drive links/RSA recipient wraps | Reusable grants with product-specific UI | Drive implementation remains active; Photos UI stub | Drive mature relative to Photos; platform untouched | No Photos share authorization/key flow | **KEEP / MIGRATE** Drive contracts, implement Photos explicitly |
| Billing | Direct Razorpay and scattered state writers | Subscription authority + canonical Usage writer | Main transitions centralized, provider adapter unused | Mostly migrated in core, partial at edges | Presign/metering overwrite plan outside canonical writer | **FIX** F21; avoid needless gateway rewrite |
| Trash/orphans | Direct deletes and historical TTL | Confirm blob deletion, then retire records | Cron and upload ledger exist | Implemented incorrectly | Swallowed errors, missing chunks/owner, deleted-object exclusion | **FIX** F09/F10 |
| Realtime | Legacy credentials | 60s single-use v2 tickets, exact origins, revocation | Shared contracts + custom Node verifier active | Mostly migrated | WebSocket origin enforcement incomplete; duplicated server implementation | **FIX** F28 |
| Office/renderers | Trusted-origin/editor variants | Hostile static runtime + bounded bridge | Strong bridge and persistence work; static scaffold mismatches actual artifact URL | Partial | CSP/paths and disabled scaffold | **KEEP / FIX** F22 |
| Local-first | Local caches + server APIs | Durable sync/mutation model | Local read/search caches; uploads can resume within cap | Partial | No general offline mutation log or conflict sync; timestamp cursor loses ties | **FIX** F20; extend incrementally |
| AI/future products | Plans | Local inference by default | `v2_ml_plan.md`; no runtime integration | Planned, not implemented | No explicit consent execution contract because feature absent | **KEEP** privacy constraints; defer implementation |

## Canonical choices

**KEEP** Accounts as identity/Vault authority, `identity-core` for common protocol utilities, `spaces` for access, and `crypto-core` for new envelope formats. **MIGRATE** Drive and Photos to a shared storage repository and versioned file-crypto adapter, not to imports across app boundaries. **KEEP** existing old-format readers until inventory proves all data migrated. **REMOVE** unused migration/adapter scaffolding only after checking callers and deployment scripts; filename labels alone do not establish dead code.

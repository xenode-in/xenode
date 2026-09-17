# Executive summary

Xenode has completed a substantial **structural split into Accounts, Drive and Photos**, but the security and data lifecycle refactor is incomplete. The new packages are used in real execution paths. This is not a repository of disconnected architectural proposals. It is also not ready to be treated as a production-safe, zero-knowledge suite.

The most serious finding is **F01: the authentication password is also the Vault encryption password**. Accounts receives that password during signup/sign-in and password verification. The browser feeds the same value to Argon2id to wrap the account root key, while the server stores the salt, KDF parameters and encrypted envelope. A server that observes the password can derive the wrapping key and recover the ARK. A synthetic probe using the repository's actual crypto functions reproduced this. TLS and hashing the authentication password at rest do not fix that trust-boundary failure.

## What is actually implemented

**Accounts** is the Better Auth authority and OIDC provider. It provisions host-only identity cookies, username/email and social login, email OTP verification, Vault v2 envelopes, recovery material, product-key handoffs and browser-session management. The working tree additionally introduces combined authentication/Vault passkeys, OAuth second-factor handling and staged password rotation. Those additions have raw Mongo ID mapping and consistency defects; passing TypeScript does not establish their correctness.

**Drive** is the most substantial product. It has encrypted browser uploads, chunked media, client decryption, local search/cache, sharing, organizations/teams, billing, admin, Office editing adapters, revisions and trash. The new Space boundary is widely adopted, but some generic routes resolve membership without checking the action. Storage is still partly governed by legacy bucket/prefix assumptions. Completion trusts reported byte counts; purge loses information needed to delete current chunks and still reads obsolete ownership fields.

**Photos** is a separate product with its own session and product key. Its upload, image derivatives, ciphertext cache, signed retrieval and timeline pagination are implemented. Its crypto and storage completion are app-specific. Albums are not a finished encrypted user flow, sharing is a placeholder, deletion/restore is missing, and the tested virtualization helper is not used by the rendered timeline. Its CSP conflicts with the default B2 and realtime origins.

**Shared platform** consists of 15 packages. Identity, envelopes, Space authorization and contracts are useful foundations. `upload-engine` is a queue/retry/policy abstraction, not a complete shared multipart or encrypted-file runtime. Most storage, billing, sharing, media parsing, search and domain models still live in Drive. Photos accesses the same physical storage collection through raw Mongo queries.

## Release-blocking priorities

| Priority | Finding | Impact | Action |
| --- | --- | --- | --- |
| 1 | F01 | Server-observed password can recover the ARK | **REPLACE** shared auth/Vault-secret design |
| 2 | F07, F08, F13 | Membership-only writes and prefix-based storage access undermine role/product isolation | **FIX** action checks and upload ownership |
| 3 | F09, F10, F12 | Purge/orphan cleanup and Photos rollback can lose references or damage completed uploads | **FIX** deletion and completion state machines |
| 4 | F03–F06 | New Accounts security flows can fail or desynchronize credentials and encrypted keys | **FIX** before shipping the working-tree changes |
| 5 | F18 | Rotation retires old workspace key grants without migrating old content | **FIX** version-aware key access and rotation |
| 6 | F14, F22, F23 | Browser policy, container/runtime packaging and affected dependencies prevent a defensible release | **FIX**, with exposure-specific advisory triage |
| 7 | F02, F15, F25 | Key persistence and metadata behavior contradict privacy claims | **FIX / MIGRATE** with explicit format and policy decisions |

See [the findings register](12-findings-register.md) for scope and qualifications. No evidence of an actual compromise was sought or established.

## Validation result

Executed from the repository root with installed dependencies, forcing Turbo execution:

| Check | Result |
| --- | --- |
| `npm run typecheck -- --force` | Pass; 16 workspaces |
| `npm run check:boundaries` | Pass; 3 apps, 15 packages |
| `npm run test -- --force` | Fail; 379 tests passed, 2 failed overall |
| Drive tests | 288 passed, 2 failed; 55 files passed, 1 failed |
| Accounts / Photos app tests | 26 / 6 passed respectively |
| `npm run lint -- --force` | Fail; Drive reports 169 errors and 213 warnings |
| `npm run test:security` | Fail; actually a scoped ESLint command, 2 errors |
| `npm audit --json` | 22 affected package entries: 2 critical, 11 high, 9 moderate; not 22 demonstrated exploits |
| Production build, browser E2E, live B2/Redis/OIDC/payment integration | Not executed; not certified |

The two Drive failures are in `tests/security/drive-session-resolution.test.ts`. Its fixtures create only a `User` and `ProductSession`, while the resolver now also requires an onboarded `AccountProfile`, `UserVault.passwordEnvelope`, and credential account. This is a concrete stale-fixture explanation, not proof that correctly onboarded users cannot sign in.

## Recommended direction

**KEEP** the three-product split and the working platform primitives. **FIX** boundaries and lifecycle correctness before adding more products. **MIGRATE** one compatibility seam at a time with data-format versioning and old-content read tests. Avoid another repository-wide rewrite: it would obscure exactly the continuity risks this audit uncovered. The roadmap starts with E2EE containment, authorization and deletion safety, then finishes shared file infrastructure and product workflows, and ends with a reproducible release gate.

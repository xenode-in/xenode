# Tests and production readiness

## Executed validation

Environment: Windows PowerShell, Node **24.11.1**, npm **11.6.2**, installed lockfile tree. HEAD `3c863e5`, including the existing uncommitted work. Turbo cache was bypassed with `--force`. The Drive test setup uses a disposable `MongoMemoryReplSet`, mocks normal session auth and PostHog, and deletes test collections between cases.

| Command | Exit | Result |
| --- | ---: | --- |
| `npm run typecheck -- --force` | 0 | 16/16 tasks successful |
| `npm run check:boundaries` | 0 | 3 apps / 15 packages pass |
| `npm run test -- --force` | 1 | 14/15 workspace tasks pass; 379 tests pass, 2 fail across 81 test files |
| `npm run lint -- --force` | 1 | 15/16 tasks pass; Drive 169 errors, 213 warnings |
| `npm run test:security` | 1 | Two `react-hooks/set-state-in-effect` errors; this command is ESLint, not Vitest |
| `npm audit --json` | 1 | 22 affected package entries, including 2 critical and 11 high registry classifications |
| Synthetic crypto probe using repository functions | 0 | Server-observed password + stored KDF/envelope recovers same ARK; cloned non-extractable CryptoKey still decrypts |
| Isolated Better Auth/Mongo adapter probe | 0 | Actual adapter records use ObjectId `_id`/`userId`; current raw passkey/session filters fail to match |

Test file total: 56 Drive, 9 Accounts, 1 Photos app, 15 package test files. The UI/config-only workspaces do not all have tests. Raw audit logs were retained in the host temporary directory during the audit; this document records the portable results rather than embedding machine-specific console noise or secrets.

## Failing checks explained

`apps/drive/tests/security/drive-session-resolution.test.ts` fails at lines 65 and 90. `seedAccount` creates a User, and `seedSession` a ProductSession. It does not create the AccountProfile/Vault/credential account now required by `getAccountOnboardingReadiness`. The positive tests therefore receive null. **FIX** fixtures to represent complete onboarding and add negative readiness cases. Do not remove the readiness guard to satisfy these assertions.

The narrow security lint failures are `components/admin/FileRendererControls.tsx:35` and `hooks/useRendererConfig.ts:62`. Root lint includes much more historical debt. **FIX** these gates, preserving the distinction between existing errors and newly introduced ones.

## Critical-path coverage

| Path | Existing evidence | Missing meaningful coverage / action |
| --- | --- | --- |
| Envelope/recovery/device crypto | `crypto-core` 10 tests | **FIX** composed password secrecy, hostile envelope inputs, key cleanup |
| Handoff | 4 package tests; Drive consume route tests; Accounts framing tests | **FIX** real browser iframe/popup/redirect, race/replay and expiry across origins |
| ProductSession | 12 Drive OIDC tests; resolver tests expose stale fixtures | **FIX** real Better Auth records, revoke/expire/version behavior across all products |
| Passkeys/2FA | Validation/helpers; new combined integration not covered by real adapter ceremony | **FIX** Mongo adapter record shapes, PRF support/failure, OAuth pending 2FA, trusted-device revoke |
| Password change / bootstrap | Staging/CAS logic inspected | **FIX** concurrent initialization; crash at every password stage; recovery after TTL |
| Drive upload/quota | Metering and mobile finalization route tests | **FIX** actual HEAD size mismatch, generic guest routes, cross-Space fingerprint, variant bytes |
| Photos upload/cleanup | Crypto round-trip plus source assertions | **FIX** mocked S3 + real DB route tests for duplicate completion, rollback and cross-product abort |
| Upload-engine | 2 tests | **FIX** pause/cancel/retry interleavings, duplicate IDs, checkpoint failures, adapters |
| Download/corruption | Some crypto/preview helpers | **FIX** truncated/reordered chunks, failed GCM, stale cache version, retry after URL expiry |
| Large files/video | MP4 faststart has 3 tests | **FIX** real playback seeking, full-memory pressure, long uploads, Safari lifecycle |
| Photos timeline | Pure window helper test and domain cursor tests | **FIX** actual mounted DOM/scroll scale; equal timestamps; fetch errors and library changes |
| Org permissions/rotation | Extensive route tests for memberships, keys, invitations and shares | **FIX** old-file decryption after removing/demoting member; generic endpoint guest access |
| Bin/orphans | Six orphan-thumbnail tests; schema TTL absence test | **FIX** current chunks, S3 per-key failure, missing bucket, trash restore, counters and crash retry |
| Office/runtime | Bridge, persistence, conversion, source boundary tests | **FIX** real deployed artifact/static headers and malicious corpus execution |
| Billing | Metering/expiry and org route tests | **FIX** subscription/refund replay, provider ambiguity and canonical-writer enforcement |

Source-string tests can enforce intended import/markup constraints but do not execute the asserted feature. Photos' 50,000-asset test passes for a function the UI never calls. **KEEP** useful static checks but add behavior tests at composition boundaries.

## Dependency posture

`npm audit` reports affected versions in the lockfile, not proven exploitation. Next is **16.2.11**, PDF.js **6.1.200**, Socket.IO parser **4.2.6**; Vitest exists at **4.1.10** root and **4.0.18** under Photos. **FIX F23** with separate runtime and development exposure triage.

The reviewed Next Windows-server advisory covers the installed Next range and identifies 16.3.3 as its patched 16.x version. Windows is this audit host; production Docker is Linux, so production exposure to that specific issue is conditional. This is not an instruction to stop at that version if other advisories require a later one. [Maintainer advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36).

The AVIF image-optimization and PDF.js advisories also affect declared runtime packages. Confirm the deployment's reachable image optimizer and renderer feature flags, upgrade to releases covering all applicable advisories, then rerun the file corpus. [Next image advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4), [PDF.js advisory](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j).

Vitest's critical UI-server advisory concerns an exposed UI server; the executed command was `vitest run`, and no public UI server was established. **FIX** the development dependency without calling it an observed production RCE. [Vitest advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp).

Other reported entries include OAuth provider resource-indicator handling, Socket.IO parser memory exhaustion, sharp, fflate, undici and tooling/transitive dependencies. Accounts already rejects some `resource` requests, so evaluate that mitigation against every provider endpoint/content type; do not mark the package fixed from the wrapper alone. No automated dependency changes were made.

## Deployment and operational blockers

**HIGH / FIX F22:** Drive's Docker deps stage copies only Drive and two tooling manifests, although Drive now depends on many local workspace packages. Its runner copies `server.mjs` without the `lib/realtime/server-events.mjs` directly imported at startup. Root Compose has no Accounts/Photos service, does not forward the required product-cookie secrets or US/EU storage variables, and schedules a removed PayU route while omitting reconcile-subscriptions/purge-orgs. Vercel's schedule has a different job set. These artifacts do not describe one reproducible deployment.

The static editor nginx file places `limit_except` at server level, serves only root/index/runtime and rejects query strings, while the app requests `/onlyoffice/<version>/xenode/host.html?rev=...`. Both runtime configs allow `frame-ancestors https://xenode.in` rather than canonical Drive. **FIX** and run `nginx -t` plus actual iframe loading. No container/nginx startup was claimed during this audit.

**MEDIUM / FIX:** `.dockerignore` does not exclude `.env*` or their backups; `COPY . .` can include the local root/app environment files in builder layers. They were present by filename, not opened. Exclude secret files and use explicit build/runtime secret mechanisms; inspect build-cache distribution before alleging disclosure.

**HIGH / INVESTIGATE F24:** Removing the TTL from a Mongoose schema does not drop an existing database index. The test proves the schema no longer declares it, not that production lacks `deletedAt_1`. Operations currently says to start from a clean database. That is not a safe migration/rollback plan for existing user data.

## Observability and recovery

PostHog uses event/property allowlists and pseudonymous IDs. API logging is best-effort to a separate database; many operational console errors and swallowed cleanup/audit writes lack durable retry/alerting. **KEEP** no-plaintext telemetry; **FIX** counters and alerts for pending uploads, delete failures, reconciliation lag, webhook retries, auth mutation conflicts, storage usage drift and key-handoff failure codes.

Before release, **FIX** a clean-build pipeline, isolated integration environment, database/index migration manifest with dry-run and rollback, B2 object/counter reconciliation, artifact provenance checks and a restore exercise. Use synthetic accounts/media, not production personal files. Production build, actual cloud/DB configuration, live quotas, storage residency, browser WebAuthn and deployed CDN/cache headers remain unverified.

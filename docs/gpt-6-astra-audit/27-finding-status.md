# Finding status checklist

Verified against `c6044ec` on 2026-10-02 by reading current code, plus the
increments recorded in [14-implementation-progress.md](14-implementation-progress.md).
Later increments update the affected rows. A finding is **Addressed** only when
the audited defect is gone from every reachable path; **Partial** names the
remaining work; **Open** means the defect is unchanged. Release gates that need a
live browser, provider, R2 bucket, scheduler or deployment are listed separately
and are never inferred from unit or integration tests.

Baseline at verification: root typecheck 16/16, package boundaries pass, all 15
test workspaces pass (686 tests). Drive lint reports 164 errors and 210 warnings;
`test:security` fails on two pre-existing hook errors; `npm audit` reports 24
entries (2 critical, 13 high, 9 moderate).

## Audit findings

| ID | Sev | Status | Evidence | Remaining work |
| --- | --- | --- | --- | --- |
| F01 | CRIT | Addressed | 0C `dae2945`, 0ZC `71c940b`: sign-in password never reaches Vault code; bootstrap sends sealed envelopes only; 0ZG removed the unused password-envelope route | — |
| F02 | HIGH | Addressed | 0E `626a7c9`: product/ARK/Drive keys memory-only; persistence store refuses all but consented device wraps | Device wrap has no expiry; legacy IndexedDB deletion is best-effort; browser tests are a release gate |
| F03 | HIGH | Addressed | 0D `18709ac` shared Better Auth ID repository for passkeys/sessions; 0ZQ: account deletion uses `deleteAccountIdentity` (both id forms); the member-removal `session` update, which matched nothing, is removed (removal already revokes ProductSessions); remaining raw `user` lookups match both id forms | — |
| F04 | HIGH | Addressed | 0F `94c2bba`, 0G `247569e`, 0ZE `8ab963a`, 0ZG: second-factor guard, native POST/GET gates, OIDC code gate, shared recent-auth policy, per-account and database-backed rate limits, password-change rotation semantics; see [29](29-accounts-sensitive-actions.md) | Browser/provider journeys and production proxy IP configuration are release gates |
| F05 | HIGH | Addressed | 0C: sign-in password change is credential-only; staged envelope endpoints return 410 | Revocation semantics of change/set/reset tracked under F04 |
| F06 | HIGH | Addressed | 0ZC `71c940b`: one transactional bootstrap with idempotency; 0ZK: workspace grants are create-only per member and version | — |
| F07 | HIGH | Addressed | 0B `6440e31`: shared action checks on generic upload/metadata/purge routes; 0ZJ: object DELETE, bulk-delete, folder and move use `requireAccessContext(request, action)`; sidecar parent must be a live file in the upload's Space; bucket DELETE removed. 0ZP: link and direct-share edits and access-request approvals recheck `share` in each file's own Space (`assertCanShareObjects`) and link edits re-apply organization link policy; Space owners/admins can revoke others' shares. Comment routes verified role-aware (workspace non-guest, share role commenter+) | — |
| F08 | HIGH | Addressed | 0H–0L, 0S, 0ZA, 0ZH: server-random key suffix, reservations, Space-bound completion, create-only PUTs; legacy unencrypted `objects/upload` removed. 0ZJ: keys are `<spaceRoot><hex32>` with no client prefix; folders are blob-less records with encrypted names; placement is `folderId`/`ancestorIds` metadata | — |
| F09 | HIGH | Addressed | 0A, 0U, 0V, 0W, 0X, 0Z: confirmed exact deletion, durable purge intents, transactional retirement | Live R2 and deployed scheduler remain release gates |
| F10 | HIGH | Addressed | 0A, 0R `1764f03`: leased exact-ledger cleanup with cross-product references | Quarantined manifest review is operational work |
| F11 | HIGH | Addressed | 0Q, 0S, 0T, 0V, 0ZH: verified bytes and transactional finalize/revision/purge accounting; usage reads are read-only from the Space owner; non-transactional writers removed. 0ZQ: account deletion uses the purge pipeline. 0ZV: shared snapshot reconciliation uses the retirement byte definition across an owner's Spaces; a current-Admin endpoint reports OrgUsage drift, missing/invalid counters and bounded/incomplete scans without repairing counters or returning encrypted metadata. Personal totals delegate to the same reader. See [34](34-storage-usage-reconciliation.md) | Live R2 inventory/HEAD comparison remains an operational release gate |
| F12 | HIGH | Addressed | 0M, 0N, 0P `4e04408`: exact manifests, transactional completion | — |
| F13 | HIGH | Addressed | 0M–0O, 0ZB `cffd54b`: manifest-owned cleanup honoring PUT expiry | — |
| F14 | HIGH | Addressed | 0ZT: Photos' `connect-src` is exactly `'self'`, Accounts, the realtime socket and each configured R2 endpoint origin (no wildcard); endpoints and origins are build inputs. Browser check: socket allowed, unlisted R2 host refused | Uploads, previews and revocation against live R2 and a running socket server are a browser release gate |
| F15 | HIGH | Addressed | 0ZO: the editor takes a plain title and seals it as a crypto-core `album-name` envelope under the Photos HKDF metadata key (`deriveMetadataKey`, derived at unlock); the albums route accepts only an envelope bound to the route Space and the creating account; list, search and detail decrypt locally | — |
| F16 | MED | Open | Timeline mounts every tile; share/settings/help unwired; no trash API | Product completion (Phase 5) |
| F17 | MED | Open | `UploadRecord` stores plaintext names and no Space/wrap context; resume uses bare `fetch`; checkpoints are read-modify-write | Encrypted versioned journal bound to job scope |
| F18 | HIGH | Addressed | 0ZK: rotation keeps remaining members' older grants; every new keyholder (invite, deferred grant, promotion, team add) must receive every issued version; grants are create-only; grant changes are fenced and validated in one transaction; demotion drops team access. 0ZL: readers select keys by the record's `spaceKeyVersion`; metadata uses per-version HKDF keys; new records must use the newest version (checked in the commit transaction); one shared keyring load per scope. Contract in [32](32-workspace-keyring.md) | — |
| F19 | MED | Partial | 0T removed the editor byte proxy | Downloads, version content and shares still stream through Next with `max-age=3600` regardless of token lifetime |
| F20 | MED | Open | `updatedAt > lastSync`, time-only sort, global `localStorage` cursor, no tombstones | Tuple cursor per account/Space with tombstones |
| F21 | MED | Partial | Presign no longer writes plans (0S); 0ZH removed metering's expired-plan downgrades and usage upserts | Onboarding plan reset, expire-plans cron, refund/campaign handlers, admin plan routes and OrgUsage creation on billing reads bypass the canonical service |
| F22 | HIGH | Addressed | 0ZR: one scheduler contract baked into `Dockerfile.cron`; `.dockerignore` excludes `.env*`. 0ZS: one image recipe (`deploy/app.Dockerfile`) for all three products with every workspace manifest and the custom server's runtime files; builds need no secret or database; Compose runs every product, both runtimes and the scheduler with per-service secrets and required-value checks; runtime nginx templates pass `nginx -t`, serve the versioned OnlyOffice tree with queries, take `frame-ancestors` from `DRIVE_ORIGIN` and send same-site CORP plus COEP. Verified by `docker compose build`/`up` and a browser framing check (allowed from Drive, blocked from Accounts) | Real OnlyOffice artifacts in the deployed editor origin and the malicious-file corpus are release gates |
| F23 | HIGH | Partial | 0ZF: non-force upgrades (Next 16.3.8, pdfjs-dist 6.3.289, Better Auth family 1.7.7, socket.io-parser 4.2.7, engine.io 6.6.11, sharp 0.35.5, axios 1.20.0, vitest 4.1.11); `npm audit` 24 → 0; CI now gates on `npm audit` | 2026-10-05: GHSA-vfj7-8cjw-p6xm (`braces` ≤ 3.0.3, glob-pattern DoS) has no patched release; it reaches only dev/build tooling (`shadcn` CSS/CLI, `eslint-config-next`, `ts-morph`), whose patterns are developer-controlled. The CI audit gate stays red until upstream ships a fix; npm's suggested fixes are breaking downgrades. Renderer corpus re-run is a release gate |
| F24 | HIGH | Addressed | No Vault v1/PBKDF2 code remains; 0ZM: the self-keyed name format is no longer read by `decryptMetadataString`, the crypto worker or the deleted `decryptFileName` | — |
| F25 | MED | Open | `update-metadata` writes plaintext description/link; share `bundleName` and access-request notes are plaintext; tag/folder plaintext fallbacks | Encrypt user text or remove the fields; define observable metadata |
| F26 | MED | Open | Drive content/chunk/metadata AES-GCM has no AAD; chunk order is unauthenticated | Versioned authenticated file manifest |
| F27 | HIGH | Addressed | 0ZD `c6044ec`: current Admin authority and versioned revocation | Live browser/deployment check is a release gate |
| F28 | MED | Addressed | 0ZI: shared protocol module, Engine.IO Origin allowlist, origin- and session-bound tickets, WebSocket-only, fail-fast Redis, session/15-minute deadline, fresh ticket per attempt; see [30](30-realtime-contract.md) | Deployed proxy/Redis and real browsers are release gates |
| F29 | MED | Partial | 0Z requires R2 endpoints and region `auto` | Shared bucket-name default, unknown bucket → `asia`, no startup validation of complete distinct regions |
| F30 | HIGH | Addressed | 0ZN: the projection route, `PhotosService.createProjection` with its repository methods, and the ownership-relabel script are removed; PhotoAssets come only from Photos upload completion | — |
| F31 | MED | Partial | 0ZS: Node 24 in CI, all images and root `engines`; CI builds without secrets | `test:security` is scoped ESLint and fails on pre-existing hook errors; no lint or container checks in CI |

## Findings discovered during verification

| ID | Sev | Status | Evidence | Required work |
| --- | --- | --- | --- | --- |
| F32 | HIGH | Addressed | 0ZE: step-up reserves attempts from the account budget shared with Better Auth's lockout; native session-mode verification denied while pending; see [28](28-second-factor-contract.md) | Real authenticator journeys are a release gate |
| F33 | HIGH | Addressed | 0ZE: deny-by-default pending sessions plus the provider's `postLogin` gate; reproduced code leak via `Location` on password sign-in with `oauth_query`, now prevented (negative control confirmed) | Real social-provider journey is a release gate |
| F34 | MED | Addressed | 0ZE: native GETs from pending sessions are allowlisted (session listings return 403) | — |
| F35 | HIGH | Addressed | 0ZJ: move is a metadata-only transaction (no copy, no delete); version snapshots, chunks and signed URLs keep their keys; contract in [31](31-drive-folder-model.md) | — |
| F36 | MED | Addressed | 0ZR: the scheduler writes the bearer header to a root-only file read by `curl -H @file`, unsets the secret before `crond`, and logs only schedules and URLs; verified in a container (secret absent from logs, crontab, process list and crond's environment; header sent) | — |
| F37 | MED | Addressed | 0ZH: both routes and their orphaned non-transactional helpers removed | — |
| F38 | HIGH | Addressed | 0ZS: Drive's startup validation required `BETTER_AUTH_SECRET`, so product containers held Accounts' identity secret (with database access, enough to decrypt the OIDC signing key); PostHog IDs used it as a salt; product cookie secrets fell back to one shared value. Only Accounts receives it now and no fallback remains | — |
| F39 | MED | Open | [06](06-e2ee-security-audit.md) renderer section: Drive's broad CSP is report-only, while PDF.js runs in the application realm | Enforce a Drive CSP after inventorying third parties (Razorpay checkout frames, PostHog) and checking them in a browser |
| F40 | MED | Addressed | 0ZU: shared validation requires explicit production product origins; OIDC/logout, handoff, WebAuthn, browser links, realtime and CSP use configured values; web OAuth allowlists replace hardcoded callbacks instead of appending staging to production; removed the unconditional root-host redirect. See [33](33-product-origin-contract.md) | Real provider/proxy/browser journeys remain release gates |

## Release gates not verified by tests

- Real browser journeys: password/OAuth/passkey sign-in, second factor, Vault
  unlock, handoff into Drive and Photos, lock/reload/account switch.
- Live R2: signed create-only PUT, presigned GET, CORS, exact deletion and HEAD
  confirmation in every configured region.
- Drive folder journeys in a real browser: create, upload into, move, Bin,
  restore and Empty Bin across personal, organization and team Spaces.
- Deployed schedulers calling every cron route with the production secret.
- Realtime server behind the production proxy with hostile Origin, replay and
  session expiry.
- Production deployment behind TLS and the real proxy, real OnlyOffice
  artifacts served from the editor origin, and the malicious-file corpus
  (local container startup, `nginx -t` and framing were verified in 0ZS).
- Production indexes, bucket policy and backups inspected rather than inferred.

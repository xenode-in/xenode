# Recommended continuation roadmap

This is an ordered continuation plan, not a request to rewrite Xenode. Each phase preserves old-content readability and narrows the release risk. Security work begins immediately rather than waiting until after new features.

## Phase 0 — Contain confidentiality and data-loss risks

1. **REPLACE F01:** choose a Vault secret protocol that does not expose the ARK wrapping secret to the auth server. A separate non-transmitted Vault secret is the simplest architectural separation; a single-password experience needs a reviewed protocol, not a homegrown verifier shortcut. Preserve/recover existing ARKs before changing envelopes.
2. **FIX F07/F08/F13:** require action authorization for every mutation, server-issued upload identities and exact variant ownership. Prevent Photos cleanup or Drive presign from acting on another product's existing keys.
3. **FIX F09/F10/F12:** make deletion fail closed, include chunks/versions/derivatives, preserve metadata on uncertain deletion, scope rollback to the operation that created it, protect trash references.
4. **FIX F18:** stop retiring usable historical key access until existing content has a verified read/rewrap path.
5. **FIX F23:** triage and patch applicable exposed runtime advisories; isolate development servers and upgrade affected tooling.

Acceptance: synthetic server inputs cannot decrypt the ARK; guests cannot mutate via any generic route; wrong-product cleanup cannot delete a blob; storage failure retains retry state; duplicate completion preserves one valid asset; removal/rotation leaves remaining members able to decrypt old files.

Data safety: **INVESTIGATE** existing Vault/file formats, legacy metadata and TTL indexes with a read-only inventory first. Back up encrypted metadata and key envelopes. Never “repair” a Vault by generating a new ARK while old files still depend on the original.

## Phase 1 — Stabilize identity and core lifecycle contracts

- **FIX F03/F04:** route new passkey and 2FA database access through normalized repositories; apply consistent authentication/second-factor/recent-auth rules to APIs and OIDC methods; converge all session revocation triggers.
- **FIX F05/F06:** durable password/envelope coordination and idempotent full Vault bootstrap, with concurrency/crash tests.
- **FIX F02:** enforce memory-only product keys; define separately consented device wrapping; guard lock/restore generations and session/key-version changes.
- **FIX F11/F21:** authoritative byte accounting across variants and products; one billing plan writer; operation-scoped compensation/reconciliation.

Acceptance: real Better Auth-created Mongo records work in passkey/2FA flows; every interruption point has a safe retry; no new key survives lock/reload except explicitly authorized device-wrap material; metering reconciles exactly to referenced physical variants and retained versions.

## Phase 2 — Finish shared infrastructure incrementally

- **MIGRATE** storage models/repositories and regional signing/deletion into a shared server seam. Replace Photos raw writes and Drive bucket assumptions behind existing APIs first.
- **MIGRATE** upload transport/journaling into concrete UploadEngine adapters. Keep domain transforms separate. Preserve IDs/wrap fields/Space context in resume records.
- **MIGRATE** file crypto into versioned shared formats with explicit old readers; derive metadata purpose keys with shared HKDF.
- **MIGRATE F19:** direct signed download/edit-upload contracts; preserve range/cache/CORS behavior and revision checks.
- **FIX F28/F29:** exact WebSocket origins, session-lifetime behavior and validated distinct regional configurations.

Acceptance: both products use the same tested ownership/quota/cleanup path; no product imports another app; format-version compatibility matrix passes; all supported regions exercise the complete upload/download/delete round trip.

## Phase 3 — Complete Accounts recovery and device semantics

- **FIX** lost-login recovery and passwordless policy; test password/passkey/OAuth combinations on a new browser.
- **MIGRATE** passkey generations with clear RP/origin compatibility and removal safety. Do not delete older credentials before an alternative unlock is verified.
- **FIX** account session, trusted second factor and Vault device trust as distinct revocable concepts; make global signout semantics precise for offline devices.
- **FIX** auditable, sanitized security events and rate limits on custom sensitive endpoints.

Acceptance: an account with only its documented recovery kit can follow the supported recovery policy without silent data loss; old and new credentials have a tested migration; remote revoke terminates server access and connected browser use; loss of a device never implies false promises of remote erasure.

## Phase 4 — Finish Drive reliability

- **FIX F17/F20:** workspace resume and stable tuple sync; account/Space cache partitioning and durable tombstones.
- **FIX** bounded large-file encryption/decryption, retry/cancel interleavings and URL expiry handling.
- **FIX** renderer deployment and versioned artifact verification, then run real malicious-file tests.
- **FIX F27:** current Admin status/role and revocation checks.
- **MIGRATE** large UI components only along the now-tested file/query/preview operations.

Acceptance: large uploads survive supported interruptions; old/new/rotated file formats download and preview; actual renderer host rejects application APIs and accepts only the intended bridge; disabled admins cannot keep using privileged JWTs; sync survives equal timestamps, offline absence and hard purge.

## Phase 5 — Complete Photos as a product

- **FIX F14/F15:** correct browser network policy and real album-name encryption/decryption.
- **FIX** asset trash/restore/purge, real album media and real sharing authorization/key distribution.
- **MIGRATE** EXIF/date provenance, image variants, video preview/streaming and backup fingerprints through common adapters.
- **FIX F16:** measured timeline virtualization, bounded caches and full-library pagination/search behavior.
- **INVESTIGATE / MIGRATE F30:** a client-assisted Drive-to-Photos transfer that accounts for different keys, format and ownership; never just relabel `productId`.

Acceptance: upload → timeline → album → share → revoke → delete → restore → purge works for images/video and all regions; a 50,000-item library keeps bounded mounted content; no ordinary album title reaches the server plaintext; cancellation/crash leaves recoverable or safely reclaimed storage.

## Phase 6 — Independent security and release validation

- **FIX** composition tests covering all trust edges and wrong-account/product/Space inputs.
- **FIX** clean install/build/container startup for all three products and static runtimes, with one scheduler contract and explicit secrets/regions.
- **FIX** versioned migration/dry-run/rollback tools and a production-like backup restore exercise.
- **FIX** dependency and malicious-file release gates, observability and error-recovery runbooks.
- **INVESTIGATE** an independent cryptographic/design review after the protocol changes, especially sharing key authenticity, key rotation and device trust.

Acceptance: typecheck, full lint, boundaries, unit/integration tests, browser E2E, dependency triage, build and deploy smoke checks are reproducible; no release gate is replaced by a source-string assertion. Operational checks establish actual indexes, bucket policy, region and scheduled-job state rather than inferring them from docs.

## Work deliberately deferred

**KEEP** future product/AI plans but defer their implementation until identity, file lifecycle and local sync are safe. **REMOVE** confirmed obsolete scaffolding only after compatibility inventory. **KEEP** working Drive sharing/CAS and shared envelope/OIDC foundations throughout; do not replace them solely for stylistic uniformity.

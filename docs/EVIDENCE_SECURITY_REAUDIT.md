# Evidence-Based Security Re-Audit

Date: 2026-06-15

## Evidence Standard

- Existing cryptographic primitives and formats are considered valid unless a reproducible defect proves otherwise.
- Manually verified Android-to-Web and Web-to-Android encrypted file interoperability is accepted as passing evidence.
- Findings require code evidence, a reproducible scenario, impact, and confidence.
- Speculative concerns are observations, not vulnerabilities.

## Verified Passing Behavior

| Behavior | Evidence | Confidence |
| --- | --- | --- |
| Android-created encrypted files are usable on Web | Manually verified by project owner; automated single-blob and chunked cross-client tests added | High |
| Web-created encrypted files are usable on Android | Manually verified by project owner; automated single-blob and chunked cross-client tests added | High |
| Filename and content-type metadata interoperate | Automated cross-client metadata tests | High |
| Vault and recovery wrapping derivations interoperate | Automated cross-client PBKDF2/AES-GCM envelope tests | High |

The previous `0x03` metadata-object concern is withdrawn. No failing user workflow or incompatible fixture established a defect.

## Confirmed Findings and Remediation

### High: Android account-scoped material could survive alternate logout paths

- Evidence: cached keys used global SecureStore identifiers; drawer and verification-screen logout paths called `authClient.signOut()` directly; the background worker loaded cached keys without binding them to the authenticated user.
- Reproduction: authenticate as user A, use an alternate logout path, then authenticate as user B or allow the background worker to hydrate before a vault identity check.
- Impact: stale keys or sync configuration from user A could be loaded in user B's process context.
- Remediation: cached keys now carry an owner identifier, loads require the active user ID, persisted sync configuration records the owner, the background worker validates the live session, the in-memory sync singleton clears account credentials, and all logout paths use centralized local cleanup.
- Verification: automated account-owner and alternate-logout-path regression tests.
- Confidence: High.

### High: Web encrypted uploads silently downgraded to plaintext

- Evidence: both Web upload flows caught encryption errors and continued with the original plaintext file.
- Reproduction: force an encryption helper to throw while the vault is unlocked.
- Impact: a user expecting E2EE could upload plaintext without an explicit confidentiality decision.
- Remediation: encrypted upload flows now fail closed with `EncryptionRequiredError`; regression test added.
- Confidence: High.

### Medium: Android allowed cleartext traffic globally

- Evidence: `android.usesCleartextTraffic` was `true`.
- Reproduction: build the Android application and direct it to an HTTP endpoint.
- Impact: production API traffic could be configured without transport encryption.
- Remediation: production defaults to HTTPS-only; local HTTP development requires explicit `EXPO_PUBLIC_ALLOW_CLEARTEXT_TRAFFIC=true`.
- Confidence: High.

### Medium: Mobile release checks were not clean

- Evidence: initial mobile lint run reported 11 errors and 56 warnings; TypeScript passed.
- Impact: lint errors block a clean release gate and warnings identify maintainability risks.
- Remediation: release-blocking anonymous-wrapper lint errors are configured appropriately; remaining warnings are retained for incremental cleanup.
- Confidence: High.

The Web repository's global lint baseline remains non-clean with 160 errors and 293 warnings across pre-existing application code, scripts, tests, and generated public assets. No new lint failure was introduced by this remediation.

## Observations Requiring Further Validation

- Android permissions include battery-optimization exemption and foreground-service capabilities. Their product need is plausible for photo backup, but Play policy and device-specific behavior require release testing.
- Web and Android still lack broad end-to-end UI automation for interrupted uploads, process death, expired presigned URLs, and low-storage conditions.
- Some diagnostic logging remains in sync and upload paths. No key, recovery phrase, or plaintext-content exposure was confirmed in this pass.
- Some legacy/manual Android upload paths delete temporary files only after successful upload calls rather than from `finally` blocks. Failure-path cache growth should be measured and then hardened incrementally.
- Presigned Web uploads can leave orphaned B2 objects when upload succeeds but completion fails. Existing duplicate cleanup is confirmed, but general incomplete-upload cleanup requires a lifecycle policy or reconciliation job.

## Reviewed Security Boundaries

- Authorization sweep: object, key-vault, drive, and direct-share routes use authenticated-session or share-access checks. The unauthenticated share token download/stream routes are intentionally public capabilities; no ownership bypass was confirmed.
- Sensitive logging sweep: no Android log statement containing private keys, recovery phrases, passwords, cookies, metadata keys, or wrapped DEKs was confirmed. Verbose decryption progress logs were removed.
- Temporary-file sweep: the central native JSON client and primary sync engine use failure-path cleanup; legacy/manual paths remain an observation above.
- Upload cleanup sweep: duplicate-content cleanup deletes newly uploaded B2 objects; incomplete non-duplicate uploads remain an observation above.

## Non-Issues

- No defect was established in RSA-OAEP, AES-GCM, PBKDF2 parameters, vault formats, wrapped DEKs, or encrypted-file wire formats.
- No cryptographic primitive or format was modified during this remediation.

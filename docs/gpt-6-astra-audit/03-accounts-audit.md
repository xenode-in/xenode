# Accounts audit

## Authentication and session execution

`apps/accounts/lib/auth.ts:createAccountsAuth` connects through the shared database and configures Better Auth with email/password, username, Google/GitHub when configured, email OTP, JWT, OAuth provider, TOTP and the new passkey plugin. Email verification is required; password minimum is 12; OAuth tokens are encrypted; implicit linking requires a locally verified email and matching addresses. Cookies use the Accounts prefix with cross-subdomain sharing disabled. **KEEP** these choices.

`ensureFirstPartyOAuthClients` upserts explicit web clients with PKCE and exact redirect allowlists; mobile exists in the registry but is excluded from provisioning. Drive/Photos callbacks exchange the code and verify issuer, audience, nonce, authorized party, subject, session ID and expiry before creating ProductSession records. Product cookies are separately signed and host-only. **KEEP** the authority split; do not treat the registered mobile constant as a completed mobile authentication product.

`getAccountsSession` retrieves authentication only. `requireAccountsPageSession` additionally enforces the custom OAuth second factor; `requireUnlockedAccountsPageSession` checks the unlock cookie. The latter two protect pages, but most custom Vault/account APIs call `auth.api.getSession` directly. The GET authorization wrapper includes readiness/2FA/unlock checks; POST generally delegates to Better Auth. **FIX F04**: centralize the server policy and test every custom mutation under a pending OAuth second factor. Better Auth protection on `/api/auth/*` does not automatically protect unrelated `/api/vault/*` handlers.

## Vault initialization and key hierarchy

`lib/vault-setup.ts:createAccountVault` generates a 32-byte ARK, independent Drive/Photos keys and a 4096-bit RSA sharing keypair. It seals password, recovery, device and sharing-private-key envelopes with the shared v2 functions. Argon2 parameters are 64 MiB, three iterations, parallelism one, 32-byte output; `crypto-core` bounds received KDF parameters. Recovery uses BIP39-derived material. These are real browser operations, not server encryption.

However, the same password is submitted to Better Auth and used as the wrapping-key input. `confirmVaultUnlock` additionally submits it to `/api/vault/unlock`. **REPLACE F01** with a secret separation protocol reviewed against the server threat model. Do not merely rename variables or increase Argon2 cost.

Initialization writes both product-key envelopes before it commits the Vault. Product-key PUT is a same-version upsert without a Vault transaction/revision constraint. Concurrent attempts can overwrite keys for an ARK different from the one whose Vault write succeeds. **FIX F06**: stage the complete envelope set as one idempotent initialization operation and retain the same client-generated material for retries. The current setup function only zeroes its root/password buffers on success, so failure cleanup also needs `finally`.

## Passkeys, devices and multi-device behavior

There are three generations to distinguish:

| Path | Actual role | Status/action |
| --- | --- | --- |
| Drive `/api/passkey/*` + local `Passkey` model | Legacy PRF unlock after an existing Drive ProductSession; does not mint user sessions | **MIGRATE / INVESTIGATE** actual clients before removal |
| Accounts `/api/vault/passkeys/*`, `VaultPasskey` | Accounts-origin WebAuthn/PRF Vault unlock | **KEEP** compatibility during transition |
| Working-tree `account-passkeys.ts`, `/api/account/passkeys`, `AccountPasskeyBinding` | One passkey for Better Auth sign-in and PRF ARK unwrap | **FIX F03** before release |

The installed Mongo adapter maps `id` to `_id` and converts ID references to ObjectId by default. New raw passkey queries use `{id: ..., userId: string}` and enumerate `passkey.id`; session verification/trust updates use `{id: session.id, userId: string}`. These bypass adapter transformations. The shared account repository already handles both string/ObjectId user IDs. **FIX** by using the adapter or a tested shared repository, checking matched counts, and testing against records actually created by Better Auth.

`device-sessions.ts:groupAccountDevices` groups product sessions by their issuing browser-session ID and derives labels from user agents. This is a session inventory, not hardware attestation or a device public-key registry. `device-vault.ts` separately stores a persistent browser wrapping key and a device envelope. Remote session revocation and cryptographic device trust are consequently different controls. **KEEP** that distinction in API contracts and UI language.

ARK caching is unconditional after successful unlock even when `trustDevice:false` avoids creating a new browser device envelope. **FIX F02**: the “remember” choice does not currently establish a memory-only unlock. Product cache records lack session/key-version lifecycle binding and asynchronous restore can race lock.

## Password change and recovery

The working-tree password dialog stages a new envelope, changes Better Auth credentials, then commits the envelope. Staged data expires after 15 minutes. Login tries an unexpired pending envelope and attempts automatic commit. This is useful recovery intent, but not crash-safe coordination: a tab/network failure after changing credentials can outlast the stage, and direct Better Auth `/change-password` remains callable independently. **FIX F05** with durable, idempotent reconciliation and verified recovery tests; never allow a credential change to strand the only password envelope.

Recovery primitives and broker recovery-phrase unlocking exist. `addPasswordToVault` handles a logged-in legacy passwordless Vault. A complete unauthenticated lost-password/account recovery journey is not present: there is no configured `sendResetPassword` flow, and the email OTP callback returns for non-verification types. Therefore recovery phrase generation is implemented, but general lost-login recovery is incomplete. **MIGRATE** recovery into an explicit authenticated/proof-based workflow while preserving the ARK and encrypted file access.

The shared readiness gate requires a password credential and password envelope even when passkey/recovery envelopes exist. Fully passwordless product onboarding is therefore not supported by the current contract. **INVESTIGATE** desired product policy; document it rather than claiming passwordless completion.

## Logout and revocation

The canonical logout coordinator revokes product records, increments versions, publishes revocation markers/events, and uses short-lived cleanup transactions to clear host-only cookies and browser caches across products. Global signout also removes browser-device envelopes and revokes Accounts sessions. **KEEP** this substantial improvement.

The password-change PUT instead updates ProductSession `revokedAt` directly, without the coordinator's version increment/realtime publication. Native Better Auth signout/revoke endpoints likewise have no general session-delete hook that revokes linked ProductSessions; canonical UI paths do extra work. **FIX F04/F05** so all relevant revocation triggers converge. Persistent key deletion on another device cannot be guaranteed while that device is offline; revocation prevents future server authorization and must not be described as erasing previously downloaded secrets.

## Production judgment

Accounts has the strongest new platform foundation but fails the core zero-knowledge claim and has unfinished security-sensitive working-tree paths. **KEEP** identity/OIDC and shared envelope primitives. **REPLACE** the shared-password boundary. **FIX** ID mapping, API second-factor enforcement, key initialization and password recovery before treating passkey/2FA UI as complete. Current Accounts tests predominantly exercise helpers, validation and source contracts, not a real multi-origin Better Auth login/PRF/rotation/revocation journey.

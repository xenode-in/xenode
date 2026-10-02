# Atomic Accounts Vault bootstrap

This contract supersedes the separate product-key and Vault writes described in
F06. Xenode has disposable development data; there is no legacy bootstrap
compatibility or partial-state migration path.

## API

`POST /api/vault/bootstrap` requires an Accounts session with its second factor
complete, the exact Accounts Origin, authentication within ten minutes, and an
`Idempotency-Key` containing 16–128 ASCII letters, digits, underscores or hyphens.

The JSON body contains exactly:

- `passwordMode: "separate"` and an account-bound Argon2id `passwordEnvelope`;
- an account-bound `recoveryEnvelope`;
- `deviceEnvelopes`, empty by default or containing one explicitly consented
  browser-device envelope;
- the public RSA `sharingPublicKey` and ARK-wrapped `wrappedSharingPrivateKey`;
- `productEnvelopes: { drive, photos }`, each bound to this account's canonical
  personal Space, product, key identity and initial key version 1.

Only active v2 AES-GCM envelopes are accepted. IVs are 12 bytes; encrypted
256-bit root/product keys are 48 bytes including the authentication tag.
Unknown payload/envelope/KDF fields are rejected. Payloads are bounded to 64 KiB
characters. The server cannot prove that opaque ciphertext wraps the same ARK;
the canonical browser creator constructs that hierarchy locally.

One snapshot/majority transaction claims the unique account Vault, ensures an
active owned personal Space, inserts both product keys and records a sanitized
creation event. Existing Vaults, orphan product envelopes or an inactive Space
cause a conflict; nothing is overwritten or reactivated. An error at any write
rolls back all writes, including the Space creation and its fence update.

| Result | HTTP | Behavior |
| --- | --- | --- |
| Created | 201 | `{ vault: { vaultRevision: 1 }, idempotent: false }` |
| Exact replay | 200 | Same initial receipt, `idempotent: true` |
| Existing/different hierarchy or changed payload | 409 | `vault_bootstrap_conflict`; no replacement |
| Authentication/Origin/second-factor/recent-auth failure | 401/403 | No bootstrap writes |
| Invalid JSON/context/operation ID | 400 | No bootstrap writes |
| Oversized body | 413 | No bootstrap writes |
| Database or unconfirmed commit failure | 503 | `vault_bootstrap_unconfirmed`; retry the exact attempt |

The immutable account-scoped operation ID and canonical payload hash live on the
Vault independently of `lastMutationId`. Later device/password revisions do not
erase the bootstrap receipt. A matching operation ID with different ciphertext
is a conflict. Retry receipts refer to creation revision 1, not the latest Vault
revision; later mutation clients read the current Vault separately.

`GET /api/vault` and `GET /api/space-product-keys` remain read endpoints. Their
general PUT replacement handlers are removed. Rotation requires its own
coordinated contract; it cannot silently replace same-version keys here.

## Browser retry lifecycle

`prepareAccountVault` generates and seals one hierarchy, zeros generated raw
buffers, and returns only ciphertext plus a random operation ID. Both setup
clients retain this attempt in tab memory across failed requests. They do not
regenerate keys or recovery words on retry. `createAccountVault` verifies the
original recovery secret and local password against that attempt before sending
it, then caches its ARK only after a confirmed receipt. Raw buffers are cleared
on success and failure; no retry payload or root/product key is persisted.

If account-preference completion fails after a successful bootstrap, onboarding
retries that completion without recreating the Vault. A tab reload discards the
attempt. If the server already committed, normal Vault unlock handles the
existing hierarchy; if it did not, a fresh atomic bootstrap may proceed.

## Development and validation

Use `npm run dev:mongo`, which starts an ephemeral replica set. Restarting it
resets disposable development data. Re-run Accounts onboarding rather than
seeding/repairing individual Vault or product-key records. No migration, reset or
storage call occurs automatically.

Disposable replica-set tests cover concurrent competing hierarchies, concurrent
identical requests, changed-payload replay, later revision changes, failures at
the second product insertion and audit insertion, orphan keys, suspended Spaces,
device consent, account/Space/product context, malformed envelopes, KDF bounds,
and recent authentication. Browser crypto tests cover lost-response retry,
recovery-kit consistency and local-only secrets. Live browser/provider and
deployment validation remain separate release gates.

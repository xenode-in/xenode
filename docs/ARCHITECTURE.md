# Architecture

## Applications

Xenode ships three independent web applications:

```text
Accounts (identity + Vault v2)
  ├─ OIDC + ProductSession ──> Drive
  ├─ OIDC + ProductSession ──> Photos
  └─ one-time key handoff ───> product/Space key in browser memory

Drive / Photos ── ciphertext + opaque keys ──> Backblaze B2
Drive / Photos ── Space-scoped metadata ─────> MongoDB
```

Accounts owns Better Auth, user credentials, OIDC consent, Vault v2, and the
account root key ceremony. Drive owns files, sharing, organizations, billing,
admin, realtime, and the Office editor shell. Photos owns photo assets, albums,
timeline projection, and its product UI. Products may share packages and the
database, but must not import another app's source.

## Shared packages

- `contracts`: product/Space identifiers and shared wire contracts.
- `config`: validated product origins, cookie names, and server configuration.
- `database`: shared Mongoose connection, target models, and repositories.
- `identity-core`: OIDC validation, PKCE, token-claim checks, and first-party
  client definitions.
- `spaces`: personal, organization, and team Space access resolution.
- `crypto-core`: Vault v2 envelopes, AES-GCM, HKDF purpose keys, and key types.
- `crypto-react`: in-memory ProductSpaceKey state.
- `key-handoff`: ECDH/HKDF/AES-GCM handoff envelopes and binding validation.
- `upload-engine`: direct multipart browser upload orchestration.
- `photos`, `media-processing`, and `realtime`: product/domain services.

## Data ownership

`Space` is the tenant and authorization boundary. Personal, organization, and
team storage all use `spaceId`. `StorageObject` stores opaque object keys,
ciphertext metadata, encrypted DEKs, sizes, and ownership/audit identifiers.
`Usage` stores billing-safe byte counters and plan limits. ProductSession rows
are product-bound and revocable independently from the Accounts session.

## Request flows

1. A product redirects to Accounts with state, nonce, PKCE, client ID, and an
   exact registered callback URI.
2. Accounts authenticates/consents and returns an authorization code.
3. The product validates the ID token and creates its ProductSession cookie.
4. When encryption is needed, the product opens an Accounts handoff window.
5. Accounts unlocks Vault v2 locally, unwraps only the requested product/Space
   material, and seals it to the product's ephemeral destination key.
6. The product consumes the transaction once and retains keys only in memory.

File uploads and downloads go directly between the browser and B2. The server
authorizes the Space, signs object-store requests, and persists ciphertext-only
metadata.

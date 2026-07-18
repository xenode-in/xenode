# Security invariants

These are release-blocking rules.

## Identity

- Accounts is the only user credential authority.
- Drive and Photos accept only valid ProductSessions for their own product.
- OIDC requires exact callback allowlists, state, nonce, PKCE, issuer, and
  audience validation.
- Product logout revokes the ProductSession; account-wide security changes can
  invalidate all products through session-version/revocation state.
- Admin JWT auth is separate from user identity.

## Cryptography

- The account root key never leaves Accounts and is never returned by an API.
- Vault v2 password wrapping uses Argon2id plus AES-256-GCM envelopes.
- Product/Space keys are handed off only through one-time, expiring,
  destination-bound ECDH + HKDF + AES-GCM transactions.
- Product keys and Drive sharing private keys remain in browser memory.
- Each file has an independent AES-256-GCM DEK. Metadata purpose keys are
  derived with HKDF and bound to the Space.
- No PBKDF2 Vault v1, private-key hashing, wildcard postMessage origin, or
  server-side plaintext fallback may be introduced.

## Storage and authorization

- Every object read/write is authorized by Space access.
- Object keys are opaque and never contain real filenames.
- Servers and logs may contain only ciphertext metadata, encrypted keys, byte
  counts, and non-sensitive operational identifiers.
- Direct browser-to-B2 transfers use credential-free signed URLs.
- The Bin purge cron deletes encrypted blobs before database documents. A TTL
  index on `StorageObject.deletedAt` is forbidden.

## Billing

- Billing code may read Usage byte counters, plan state, and billing models.
- Billing must not import crypto/Vault code or inspect encrypted object fields.
- `syncUserSubscriptionState` is the only Usage plan/limit mutation path.
- BillingEvent payloads are sanitized and transitions are idempotent.

## Realtime and rendering

- Realtime always requires a short-lived ticket bound to account, product,
  Space, and ProductSession, signed by `REALTIME_TICKET_SECRET`.
- Realtime, CDN, Better Auth, admin JWT, and cron secrets are independent.
- `edit.` and `preview.` are static-only origins. Application/API paths return
  404 on those hosts.
- Office plaintext crosses the isolated frame only via the bounded,
  exact-origin bridge. No key, cookie, storage URL, or unrelated filename enters
  the renderer.

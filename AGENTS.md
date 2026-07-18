# AGENTS.md

## Repository

Xenode is an npm-workspaces + Turborepo monorepo for end-to-end encrypted cloud
storage. The shipped applications are:

- `apps/accounts` (`@xenode/accounts`): Better Auth authority, OIDC provider,
  Accounts hub, Vault v2, and key-handoff broker.
- `apps/drive` (`@xenode/drive`): Drive product, organizations, sharing,
  billing/admin, realtime, and Office editor shell.
- `apps/photos` (`@xenode/photos-web`): independent Photos product.

Shared packages live in `packages/`. Do not create ad-hoc database clients or
copy shared identity, Space, crypto, upload, or realtime logic into an app.

## Commands

Run from the repository root unless noted.

```powershell
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test
npm run check:boundaries
npm run test:security

# Drive-only
npx tsc --noEmit --project apps/drive/tsconfig.json
Set-Location apps/drive
npx vitest run path/to/file.test.ts
```

There is no root `typecheck` inside Next builds; always run the explicit command
after non-trivial edits. PowerShell is the supported shell for repository
scripts.

## Security boundaries

### Identity and sessions

Accounts is the only user auth authority. It uses Better Auth with
email/password, username, OAuth, OTP/TOTP, JWT, and OIDC-provider plugins. Drive
and Photos are OIDC clients and store host-only ProductSession cookies. They
must validate issuer, audience, state, nonce, and PKCE and must reject revoked,
expired, cross-product, or version-stale ProductSessions.

Drive admin auth is separate: the `Admin` collection, custom JWT, and
`Xenode_admin_session` cookie. Admins are not user accounts.

### Key hierarchy

Vault v2 is owned by Accounts. Argon2id unlocks an AES-GCM envelope containing
the ARK. The ARK wraps product/space keys and the Drive RSA sharing private key.
The ARK must never leave Accounts or be returned by a server route.

Drive and Photos receive only their ProductSpaceKey through
`@xenode/key-handoff`. Handoffs are one-time, expire, and bind account, product,
client, origin, Space, transaction, and destination public-key fingerprint.
Product keys stay in browser memory and are cleared on lock/logout.

Files use per-file AES-256-GCM DEKs. Drive keeps RSA-OAEP only for subordinate
sharing/grant compatibility. Metadata purpose keys come from
`@xenode/crypto-core` HKDF and must be Space-bound. Never reintroduce Vault v1,
PBKDF2, private-key hashing, server plaintext, or persisted raw product keys.

### Space, storage, and billing

- `Space` is the authorization boundary. Every object query and mutation must
  resolve access to the requested `spaceId`.
- `StorageObject.key` is opaque (`users/{accountId}/{randomHex32}`); never derive
  it from a filename. `encryptedName`, `encryptedDEK`, IVs, and chunks are
  ciphertext-only server fields.
- Browser clients upload/download directly to Backblaze B2. Next.js signs URLs
  and records metadata but never proxies file bytes.
- Billing may use only `Usage`, `Payment`, `Subscription`, `BillingEvent`, and
  related billing models. It must not import crypto modules or inspect encrypted
  object metadata.
- `syncUserSubscriptionState` is the sole writer of Usage plan/limit/autopay
  state. Billing transitions emit sanitized `BillingEvent` records.

### Realtime and file runtimes

Realtime tickets are always v2: 60-second, single-purpose credentials signed by
`REALTIME_TICKET_SECRET`, with exact allowed origins. Do not add a legacy or
feature-flag bypass.

`edit.xenode.in` and `preview.xenode.in` are static-only hostile-file runtime
origins. Application/API routes return 404 there. Office plaintext crosses the
iframe boundary only as bounded transferable buffers over the exact-origin
bridge. Keep `public/internal-editors/onlyoffice` and `vendor/` isolated.

The Bin is cron-purged only after encrypted B2 blobs are removed. Never add a
TTL index on `StorageObject.deletedAt`; the historical `deletedAt_1` index is a
data-loss/orphaning hazard.

## Architecture conventions

- Use `@xenode/database` models and the shared Mongoose connection. The Better
  Auth user collection is singular `user`.
- Use `@xenode/spaces` for personal/org/team access resolution.
- Use `@xenode/identity-core` for OIDC/PKCE helpers and first-party clients.
- Use `@xenode/crypto-core`, `@xenode/crypto-react`, and
  `@xenode/key-handoff`; do not invent parallel formats.
- Use `@xenode/upload-engine` for browser upload orchestration.
- User dashboard components live under `apps/drive`; Accounts profile/security
  presentation belongs in `apps/accounts`; Photos must not import Drive.

## Drive-specific conventions

- `lib/auth/session.ts` resolves Drive ProductSessions. Pass the request when a
  route supports bearer/non-browser clients.
- Billing routes use `BillingError`, `parseJson`, `jsonError`, and idempotency
  keys. Razorpay SDK failures should be normalized with
  `isRazorpaySDKError`.
- Razorpay subscriptions are authoritative; one-time order events are ignored.
  Yearly-to-monthly changes are deferred to period end.
- Refunds flow through SupportTicket + RefundRequest and refund the underlying
  payment before subscription cancellation.
- Cron is implemented as authenticated HTTP routes. There is no background
  worker; Redis is only for realtime fan-out.
- Use shadcn/ui and Tailwind primitives from `components/ui`.

Known legacy React client pages may trigger `react-hooks/set-state-in-effect` or
`react-hooks/refs`. Do not use that as justification for introducing new lint
errors.

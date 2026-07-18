# Xenode

Xenode is a privacy-first, end-to-end encrypted cloud storage monorepo. Files,
filenames, and content metadata are encrypted in the browser before upload. The
server authorizes access, stores ciphertext, coordinates direct uploads, and
maintains billing-safe byte counters; it never receives plaintext file content
or account root keys.

## Applications

| Workspace | Default URL | Responsibility |
| --- | --- | --- |
| `@xenode/accounts` (`apps/accounts`) | `http://localhost:3001` | Better Auth identity authority, OIDC provider, profile/security hub, Vault v2, and one-time key handoff |
| `@xenode/drive` (`apps/drive`) | `http://localhost:3000` | Drive, sharing, organizations, billing, admin, realtime, and the isolated Office editor shell |
| `@xenode/photos-web` (`apps/photos`) | `http://localhost:3002` | Independent Photos product using Accounts OIDC and product key handoff |

Shared packages under `packages/` define contracts, product configuration,
database models, Space authorization, identity helpers, crypto primitives,
React key state, key handoff, uploads, Photos projection, media processing, and
realtime tickets.

## Security model

- Accounts is the only user identity authority. Drive and Photos accept only
  their own host-only `ProductSession` cookies (or an explicitly supported
  bearer ProductSession for non-browser clients).
- A user unlocks Vault v2 only on Accounts. Argon2id unwraps the account root key
  (ARK); Accounts then hands a product/space-scoped key to a product through a
  one-time ECDH + HKDF + AES-GCM transaction bound to account, product, client,
  origin, transaction, expiry, and destination key fingerprint.
- The ARK never leaves Accounts. Product keys remain in browser memory. Drive's
  RSA-OAEP sharing keypair is subordinate to the ARK; only its public key is
  published.
- Files use a per-file AES-256-GCM DEK. The browser uploads ciphertext directly
  to Backblaze B2 using opaque object keys. Metadata keys are derived with HKDF
  and bound to the active Space.
- Storage is authorized by `spaceId`; product selection is never an authorization
  boundary. Billing may read only `Usage` byte counters and billing collections.
- Realtime tickets are mandatory, short-lived, and bound to product, Space,
  ProductSession, and an independent signing secret.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/SECURITY_INVARIANTS.md](docs/SECURITY_INVARIANTS.md).

## Local development

Requirements: Node.js 20+, npm, MongoDB, Redis, and an S3-compatible bucket.

```powershell
npm install
Copy-Item .env.example apps/accounts/.env.local
Copy-Item .env.example apps/drive/.env.local
Copy-Item .env.example apps/photos/.env.local
npm run dev
```

`npm run dev` starts Drive. Run Accounts and Photos in separate terminals:

```powershell
npm run dev --workspace @xenode/accounts
npm run dev --workspace @xenode/photos-web
```

Use deployment-declared local origins (`ACCOUNTS_ORIGIN`, `DRIVE_ORIGIN`, and
`PHOTOS_ORIGIN`) so OIDC callback allowlists remain exact.

## Verification

```powershell
npm run typecheck
npm run test
npm run check:boundaries
npm run test:security
npm run build
```

Run a single Drive test from `apps/drive`:

```powershell
npx vitest run tests/security/drive-oidc-session.test.ts
```

The repository currently carries known React 19 lint findings in legacy client
components. New and changed files should be linted with the owning workspace's
flat ESLint config.

## Deployment

The Drive image is built from `apps/drive/Dockerfile`. `docker-compose.yaml`
defines Drive plus the cron sidecar; Accounts, Photos, and the static-only file
runtimes should be deployed on their declared origins. Generate every secret
independently—especially `BETTER_AUTH_SECRET`, `ADMIN_JWT_SECRET`,
`REALTIME_TICKET_SECRET`, `CDN_SIGNING_SECRET`, and `CRON_SECRET`.

## License

Xenode is available under the [MIT License](LICENSE).

# Operations

## Services

- Accounts, Drive, and Photos are separate Next.js deployments.
- Drive's custom server hosts Socket.IO; Redis is used only for pub/sub fan-out.
- Cron jobs are authenticated HTTP endpoints. There is no background worker.
- MongoDB is shared through `@xenode/database`; use a replica set for transactions.
- Cloudflare R2 is the object store, accessed through its S3-compatible API;
  browser transfers are direct.

## Required secrets

Generate distinct values for `BETTER_AUTH_SECRET`, `ADMIN_JWT_SECRET`,
`REALTIME_TICKET_SECRET`, `CDN_SIGNING_SECRET`, `CRON_SECRET`,
`DRIVE_SESSION_COOKIE_SECRET` and `PHOTOS_SESSION_COOKIE_SECRET`. Only Accounts
holds `BETTER_AUTH_SECRET`; where a shared development env provides it, reusing it
for realtime/CDN signing is rejected by configuration validation.
Set exact `REALTIME_ALLOWED_ORIGIN` values and exact product origins.
Production requires `ACCOUNTS_ORIGIN`, `DRIVE_ORIGIN`, `PHOTOS_ORIGIN` and the
corresponding `NEXT_PUBLIC_*_ORIGIN` build values; no production hostname is
assumed. Configure server and browser values identically and rebuild when
changing them. Only the configured web origins enter OAuth callback/logout and
handoff allowlists; see [the product origin contract](gpt-6-astra-audit/33-product-origin-contract.md).
`ADMIN_JWT_SECRET` must contain at least 32 characters in development as well as
production. Admin JWTs are bound to current database role/status/session version;
see [the Admin session contract](gpt-6-astra-audit/26-admin-session-contract.md).

## Storage pools

Set the same non-secret `STORAGE_ENABLED_REGIONS` on Accounts, Drive and Photos
(default `asia`). Configure every enabled pool completely with distinct bucket
names; US/EU must use their matching R2 jurisdiction endpoints. Leave disabled
pool variables empty. Products validate this at runtime startup, and Accounts
advertises only the enabled list without receiving storage credentials.

Provision and verify R2 buckets and CORS outside the application. User requests
verify buckets rather than creating them, and stored mappings are never
relabelled. After resetting disposable development storage, seed verified
mappings with `npm run seed:storage-buckets --workspace @xenode/drive`.
See [the storage pool contract](gpt-6-astra-audit/36-storage-pool-provisioning.md).

## Container deployment

`docker-compose.yaml` runs every product from one recipe, `deploy/app.Dockerfile`
(`--build-arg APP=accounts|drive|photos`), plus the static `editor` and `preview`
runtimes and the scheduler. `NEXT_PUBLIC_*` settings are compiled into the
bundles, so Compose passes them as build args derived from the product origins;
an image build needs no secret or database. Each service receives only what it
reads:

| Service | Secrets |
| --- | --- |
| accounts | `BETTER_AUTH_SECRET`, OAuth client secrets, `RESEND_API_KEY` |
| drive | `DRIVE_SESSION_COOKIE_SECRET`, `REALTIME_TICKET_SECRET`, `CDN_SIGNING_SECRET`, `CRON_SECRET`, `ADMIN_*`, R2 keys, Razorpay, `RESEND_API_KEY` |
| photos | `PHOTOS_SESSION_COOKIE_SECRET`, `REALTIME_TICKET_SECRET`, `CRON_SECRET`, R2 keys |
| cron | `CRON_SECRET` |

The editor and preview runtimes must be same-site with Drive (subdomains of one
registrable domain). Drive pages are cross-origin isolated, so the runtimes send
`Cross-Origin-Resource-Policy: same-site` and their own COEP. `DRIVE_ORIGIN` is
their only `frame-ancestors` source, and nginx refuses to start without it. The
editor serves `/onlyoffice/<version>/` from `npm run onlyoffice:build-client`
output and otherwise only its fail-closed page; product images never contain
Office artifacts.

## Storage counter reconciliation

Authenticated Drive admins can read
`GET /api/admin/storage-reconciliation?orgId=<id>` to compare an organization's
OrgUsage counters with all of its organization/team Spaces in one snapshot.
The report is read-only, includes retained and binned bytes, and returns no
encrypted metadata or plan fields. Differences require investigation; the
endpoint never repairs counters. Invalid data and scans over 100,000 objects
return an explicit incomplete/invalid status rather than a partial comparison.
See [the reconciliation contract](gpt-6-astra-audit/34-storage-usage-reconciliation.md).

## Scheduled jobs

- `expire-plans`: subscription/grace lifecycle reconciliation.
- `purge-bin`: removes expired encrypted blobs before deleting object rows.
- `cleanup-orphans`: reconciles failed/incomplete object uploads.
- `purge-orgs`: removes organizations after their restoration window, and
  finishes admin account deletions: purges each closed personal Space's files,
  then its quota record and Space.

All cron endpoints require `Authorization: Bearer ${CRON_SECRET}`.

## Release gates

```powershell
npm ci
npm run typecheck
npm run check:boundaries
npm run test
npm run test:security
npm run build
```

For schema changes, start from a clean database in this migration series. In
particular, do not retain the historical `deletedAt_1` TTL index.

## Disposable development database

`npm run dev:mongo` starts an ephemeral single-node replica set on loopback.
Stopping and restarting that process resets its disposable database, including
Vaults and product envelopes. Run Accounts onboarding again to create them
through the atomic bootstrap endpoint; do not seed a Vault independently of its
personal product keys. A standalone MongoDB server cannot run the transactional
Vault/upload/deletion contracts.

Do not attempt to repair a partial old development Vault by replacing individual
product envelopes. Reset disposable development state instead. No database reset
is performed automatically by onboarding or application startup.

Better Auth 1.7 changed its account identity and OAuth provider schemas. Accounts
created by earlier development builds are not backfilled; reset the disposable
database and sign up again after upgrading.

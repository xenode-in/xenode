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
`REALTIME_TICKET_SECRET`, `CDN_SIGNING_SECRET`, and `CRON_SECRET`. Reusing an
identity secret for realtime/CDN signing is rejected by configuration validation.
Set exact `REALTIME_ALLOWED_ORIGIN` values and exact product origins.
`ADMIN_JWT_SECRET` must contain at least 32 characters in development as well as
production. Admin JWTs are bound to current database role/status/session version;
see [the Admin session contract](gpt-6-astra-audit/26-admin-session-contract.md).

## Scheduled jobs

- `expire-plans`: subscription/grace lifecycle reconciliation.
- `purge-bin`: removes expired encrypted blobs before deleting object rows.
- `cleanup-orphans`: reconciles failed/incomplete object uploads.
- `purge-orgs`: removes organizations after their restoration window.

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

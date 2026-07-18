# Operations

## Services

- Accounts, Drive, and Photos are separate Next.js deployments.
- Drive's custom server hosts Socket.IO; Redis is used only for pub/sub fan-out.
- Cron jobs are authenticated HTTP endpoints. There is no background worker.
- MongoDB is shared through `@xenode/database`; do not open parallel clients.
- Backblaze B2 is the system object store and browser transfers are direct.

## Required secrets

Generate distinct values for `BETTER_AUTH_SECRET`, `ADMIN_JWT_SECRET`,
`REALTIME_TICKET_SECRET`, `CDN_SIGNING_SECRET`, and `CRON_SECRET`. Reusing an
identity secret for realtime/CDN signing is rejected by configuration validation.
Set exact `REALTIME_ALLOWED_ORIGIN` values and exact product origins.

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

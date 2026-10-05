# Scheduled jobs

Cron jobs are HTTP routes (`/api/cron/*`) protected by
`Authorization: Bearer ${CRON_SECRET}`. Each product's `vercel.json` is the one
schedule contract:

- `vercel.json` — Drive (`cleanup-versions`, `expire-plans`,
  `reconcile-subscriptions`, `purge-bin`, `purge-orgs`, `cleanup-orphans`).
- `apps/photos/vercel.json` — Photos (`cleanup-photo-uploads`).

A test (`apps/drive/tests/security/cron-contract.test.ts`) fails when a cron
route is added without a schedule, or a schedule names a missing route.

## Vercel

Vercel reads each project's `vercel.json`. Set `CRON_SECRET` in each project.

## Docker

`Dockerfile.cron` bakes both `vercel.json` files into a small Alpine image.
`cron-entrypoint.sh` turns them into a crontab that calls each product's
origin:

```
DRIVE_URL=http://drive:3000
PHOTOS_URL=http://photos:3002
CRON_SECRET=<openssl rand -hex 32>
```

The secret is written to a root-only header file and passed to curl with
`-H @file`; it never appears in the crontab, a command line or the logs. The
container prints only the schedule and URLs. `docker-compose.yaml` runs it as
the `cron` service; `docker-compose.cron.yaml` runs it alone.

## Manual runs

```bash
./run-cron.sh <job>
```

# Running Cron Jobs in Coolify

Xenode's cron jobs are plain HTTP endpoints protected by a `CRON_SECRET` Bearer token.
Coolify doesn't have a first-class "Scheduled Tasks" UI (as of 2025), so the recommended
approach is to run a lightweight **cron-sidecar container** alongside your app.

---

## 1. Add `CRON_SECRET` to your Coolify environment variables

In Coolify → your service → **Environment Variables**, add:

```
CRON_SECRET=<a long random string>  # e.g. openssl rand -hex 32
APP_URL=https://your-xenode-domain.com
```

> **Never** reuse the `development_secret_123` value from dev. Generate a fresh one for prod.

---

## 2. Option A — Docker Compose cron sidecar ✅ (already in docker-compose.yml)

The `cron` service is already added to [docker-compose.yml](./docker-compose.yml).
Just ensure `CRON_SECRET` and `NEXT_PUBLIC_APP_URL` are set in Coolify environment variables
and the compose file is picked up by Coolify.

**Why a sidecar and not the Dockerfile?**
- The app image uses Next.js standalone output — no `scripts/` folder in the final image
- "One process per container" principle — restarting cron never affects your app
- The `cron` container is ~8 MB (alpine + curl), zero build overhead

**Schedule:**

```yaml
services:
  app:
    build: .
    # ... your existing app config

  cron:
    image: alpine:3.19
    restart: unless-stopped
    depends_on:
      - app
    environment:
      CRON_SECRET: ${CRON_SECRET}
      APP_URL: ${APP_URL}
    command: >
      sh -c '
        echo "Starting Xenode cron sidecar"
        # Install curl
        apk add --no-cache curl

        # Write crontab
        echo "0 0 * * * curl -s -X GET \$APP_URL/api/cron/expire-plans -H \"Authorization: Bearer \$CRON_SECRET\" >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
        echo "0 3 * * * curl -s -X GET \$APP_URL/api/cron/purge-bin    -H \"Authorization: Bearer \$CRON_SECRET\" >> /proc/1/fd/1 2>&1" >> /etc/crontabs/root
        echo "30 9 * * * curl -s -X POST \$APP_URL/api/payment/payu/charge-recurring -H \"Authorization: Bearer \$CRON_SECRET\" >> /proc/1/fd/1 2>&1" >> /etc/crontabs/root

        crond -f -l 2
      '
```

**Schedule reference:**

| Job                        | Schedule        | Description                              |
|----------------------------|-----------------|------------------------------------------|
| `expire-plans`             | `0 0 * * *`     | Midnight UTC — downgrade expired plans   |
| `purge-bin`                | `0 3 * * *`     | 3 AM UTC — hard-delete 30-day trash      |
| `charge-recurring`         | `30 9 * * *`    | 9:30 AM UTC — trigger PayU auto-renewals |

---

## 3. Option B — Coolify "Command" on a separate service

If you don't want a docker-compose sidecar, you can create a **separate Coolify service**
using the `alpine/curl` or `curlimages/curl` image with a startup command:

```
/bin/sh -c 'apk add --no-cache curl dcron && \
  echo "0 0 * * * curl -s $APP_URL/api/cron/expire-plans -H \"Authorization: Bearer $CRON_SECRET\"" | crontab - && \
  crond -f'
```

Set `APP_URL` and `CRON_SECRET` as environment variables on that service in Coolify.

---

## 4. Option C — External cron service (simplest for SaaS)

Services like **cron-job.org** (free) or **EasyCron** can call your HTTP endpoints on a schedule.

1. Go to [cron-job.org](https://cron-job.org) → Create Cronjob
2. URL: `https://your-domain.com/api/cron/expire-plans`
3. Method: `GET`
4. Header: `Authorization: Bearer <CRON_SECRET>`
5. Schedule: Daily at midnight UTC

Repeat for `purge-bin` and `charge-recurring`.

This is the **lowest-maintenance** option — no containers, no infrastructure to manage.

---

## Testing cron endpoints manually

```bash
# From your local machine (reads .env.local automatically):
npm run cron:expire
npm run cron:purge-bin
npm run cron:charge

# Or with curl directly:
curl -s https://your-domain.com/api/cron/expire-plans \
  -H "Authorization: Bearer $CRON_SECRET" | jq .
```

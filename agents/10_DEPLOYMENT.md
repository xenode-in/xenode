# Deployment Guide

---

## Local Development

```bash
# 1. Clone repo
git clone https://github.com/santhoshkumar-dev/Xenode.git
cd Xenode

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env.local
# Fill in all values in .env.local

# 4. Run dev server
npm run dev
# App runs at http://localhost:3000

# 5. (Optional) Run proxy server for local B2 dev
npx ts-node proxy.ts
```

---

## Docker (Local / Self-hosted)

```bash
# Build and run with docker-compose
docker-compose up --build

# Or build image manually
docker build -t Xenode .
docker run -p 3000:3000 --env-file .env.local Xenode
```

The `Dockerfile` uses a multi-stage build:

1. **Build stage** — `node:20-alpine`, installs deps, runs `next build`
2. **Runner stage** — Minimal node image, copies `.next/standalone` output

The `docker-compose.yml` sets up:

- `Xenode` service (the Next.js app)
- Environment variable passthrough from `.env.local`
- Port mapping `3000:3000`

---

## Vercel Deployment (Recommended)

```bash
npm install -g vercel
vercel deploy
```

1. Connect GitHub repo to Vercel
2. Add all environment variables from `.env.example` in Vercel Dashboard
3. Set up Vercel Cron Jobs for `/api/cron/reset-usage` and `/api/cron/cleanup`:

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/reset-usage",
      "schedule": "0 0 1 * *" // First day of every month
    },
    {
      "path": "/api/cron/cleanup",
      "schedule": "0 2 * * *" // Daily at 2am
    }
  ]
}
```

Add `Authorization: Bearer $CRON_SECRET` in Vercel Cron headers.

---

## Backblaze B2 Setup

1. Create a B2 account at backblaze.com
2. Create a new **Private** bucket
3. Create an Application Key with permissions: `Read Files`, `Write Files`, `Delete Files`, `List Buckets`, `List Files`
4. Configure **CORS rules** on the B2 bucket to allow direct browser uploads:

```json
[
  {
    "corsRuleName": "Xenode-uploads",
    "allowedOrigins": ["https://yourdomain.com"],
    "allowedHeaders": ["*"],
    "allowedOperations": ["s3_put"],
    "maxAgeSeconds": 3600
  }
]
```

5. Copy all B2 values to environment variables

---

## MongoDB Setup

1. Create a MongoDB Atlas cluster (M0 free tier works for development)
2. Create two databases: `Xenode` and `Xenode-logs`
3. Create a database user with read/write access
4. Whitelist your IP (or `0.0.0.0/0` for Vercel serverless)
5. Copy connection strings to `MONGODB_URI` and `MONGODB_LOGS_URI`

---

## Razorpay Setup

1. Create a Razorpay account at razorpay.com
2. Go to Settings → API Keys → Generate Test Key
3. Copy Key ID and Key Secret to env vars
4. Set up webhook: Dashboard → Webhooks → Add new webhook
   - URL: `https://yourdomain.com/api/payment/webhook`
   - Events: `payment.captured`, `payment.failed`
   - Copy webhook secret to `RAZORPAY_WEBHOOK_SECRET`

---

## Scripts

```bash
npm run dev       # Development server (hot reload)
npm run build     # Production build
npm run start     # Start production server
npm run lint      # ESLint check
npx vitest        # Run tests
npx vitest --ui   # Vitest UI
```

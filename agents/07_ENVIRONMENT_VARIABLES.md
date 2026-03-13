# Environment Variables

All environment variables are listed in `.env.example`. Copy it to `.env.local` for local development.

---

## Database

```bash
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/Xenode
MONGODB_LOGS_URI=mongodb+srv://user:pass@cluster.mongodb.net/Xenode-logs
```

- `MONGODB_URI` — Main application database
- `MONGODB_LOGS_URI` — Separate DB for API request logs (can be same cluster, different DB)

---

## Authentication (better-auth)

```bash
BETTER_AUTH_SECRET=your-32-char-secret-here
BETTER_AUTH_URL=http://localhost:3000
```

- `BETTER_AUTH_SECRET` — Must be at least 32 characters. Used to sign session tokens.
- `BETTER_AUTH_URL` — The base URL of the app (used for OAuth callbacks and email links)

---

## Backblaze B2 Storage

```bash
B2_APPLICATION_KEY_ID=your-key-id
B2_APPLICATION_KEY=your-application-key
B2_BUCKET_NAME=your-bucket-name
B2_ENDPOINT=https://s3.us-west-002.backblazeb2.com
B2_REGION=us-west-002
```

- The B2 bucket must have CORS configured to allow PUT requests from your domain
- For presigned uploads to work, the B2 bucket needs to allow `s3:PutObject` for the application key

---

## Payment (Razorpay)

```bash
RAZORPAY_KEY_ID=rzp_live_xxxxx
RAZORPAY_KEY_SECRET=your-secret
RAZORPAY_WEBHOOK_SECRET=your-webhook-secret
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_xxxxx
```

- `RAZORPAY_WEBHOOK_SECRET` — Used to verify webhook signatures in `/api/payment/webhook`
- `NEXT_PUBLIC_RAZORPAY_KEY_ID` — Exposed to browser for Razorpay checkout initialization

---

## Analytics (PostHog)

```bash
NEXT_PUBLIC_POSTHOG_KEY=phc_xxxxx
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com
POSTHOG_API_KEY=phx_xxxxx  # Server-side only key
```

---

## Cron Jobs

```bash
CRON_SECRET=your-secret-token
```

- Include as `Authorization: Bearer <CRON_SECRET>` when calling `/api/cron/*` endpoints
- Set up in Vercel Cron, GitHub Actions, or an external cron service

---

## App

```bash
NEXT_PUBLIC_APP_URL=https://yourapp.com
NODE_ENV=production
```

---

## Adding New Environment Variables

1. Add to `.env.example` with a descriptive comment
2. Add to `.env.local` locally
3. If client-accessible, prefix with `NEXT_PUBLIC_`
4. Update this file and the Dockerfile/docker-compose if needed
5. Add to your deployment platform (Vercel env vars, Docker env, etc.)

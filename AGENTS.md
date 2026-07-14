# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What Xenode is

Privacy-first, **end-to-end encrypted** cloud storage. Files are encrypted in the browser with a per-file AES-256-GCM key, which is wrapped by the user's RSA-4096 public key before upload. The server only ever sees ciphertext. Built on Next.js 16 (App Router) + React 19 + MongoDB + Backblaze B2.

## Commands

```bash
npm run dev          # Next.js dev server (localhost:3000)
npm run build        # production build
npm run start        # serve production build
npm run lint         # eslint (uses eslint.config.mjs)
npm run test         # vitest run
npm run test:watch   # vitest watch
npm run test:coverage

# Cron helpers — reads CRON_SECRET from .env.local automatically
npm run cron:expire  # hits /api/cron/expire-plans
npm run cron:charge  # hits the legacy PayU recurring-charge endpoint

# Run a single test:
npx vitest run path/to/file.test.ts
npx vitest run -t "test name pattern"
```

There is **no `typecheck` script** — run `npx tsc --noEmit` directly. TypeScript errors aren't part of `npm run build` either; build relies on tsc emitting via Next's compiler. Always run `npx tsc --noEmit` after non-trivial edits.

## High-level architecture

### Three security boundaries that must not cross

The codebase is divided into three domains with **enforced** separation (see `BILLING_SECURITY.md`):

1. **E2EE keys** (`app/api/keys/**`, `lib/crypto/**`, `UserKeyVault` model) — never touched by anything else.
2. **Storage** (`app/api/objects/**`) — only sees opaque random object keys (`users/{userId}/{randomHex32}`); the real filename lives encrypted in `StorageObject.encryptedName`.
3. **Billing** (`app/api/payment/**`, `app/api/subscriptions/**`, `app/api/admin/billing/**`) — **prohibited** from importing `UserKeyVault`, `lib/crypto/**`, or reading `StorageObject.encryptedDEK/iv/chunkIvs`. Billing operates only on `Usage.totalStorageBytes` and `Usage.storageLimitBytes` (bytes only, never file metadata).

If you add a new billing route and need user data, get it from `Usage`, `Payment`, `Subscription`, or `BillingEvent`. Never reach into encrypted storage.

### Two parallel auth systems

- **User auth: better-auth** ([lib/auth/index.ts](lib/auth/index.ts)) — email/password + Google OAuth + TOTP 2FA + email OTP. Sessions are cookie-based with a 7-day expiry. The user collection is named `user` (singular) to match better-auth's adapter. Read sessions in API routes with `getServerSession(request)` or `requireAuth(request)` from [lib/auth/session.ts](lib/auth/session.ts) — always pass `request` so the expo() mobile plugin can read its custom cookie header.
- **Admin auth: custom JWT** ([lib/admin/session.ts](lib/admin/session.ts)) — separate `Admin` collection with bcrypt passwords, JWT in an HttpOnly cookie `Xenode_admin_session`, 8-hour expiry. Read with `getAdminSession()` (cookies-based) or `getAdminSessionFromRequest(req)`. `requireSuperAdminSession()` gates super-admin-only actions.

The two systems are completely independent — an admin is **not** a user, and there is no role field on the user collection.

### Billing pipeline (Razorpay subscriptions only)

Xenode is **subscription-only**; one-time order events (`payment.captured`, `order.paid`) are intentionally ignored. The pipeline:

1. **Pricing config is DB-backed** ([models/PricingConfig.ts](models/PricingConfig.ts), [lib/config/getPricingConfig.ts](lib/config/getPricingConfig.ts)) — 4 plans (`basic`, `pro`, `plus`, `max`), each with per-cycle pricing rows that carry their own `razorpayPlanId`. Edit via `/admin/dashboard/pricing`.
2. **Checkout** → `/api/subscriptions/create` resolves coupon (priority) → campaign (fallback) → creates a Razorpay subscription with `notes` carrying userId/planSlug/amounts/offerId.
3. **Verify** → `/api/subscriptions/verify` validates HMAC, upserts Subscription/Payment/SubscriptionInvoice docs, syncs Usage state, consumes the coupon.
4. **Webhooks** → [lib/billing/webhooks/handlers.ts](lib/billing/webhooks/handlers.ts) is the **single authoritative state machine**. Handlers are idempotent (Razorpay retries on non-2xx) and never throw. `subscription.charged` creates invoices + payments, `subscription.halted/pending` flips Usage to grace, `subscription.cancelled` marks it cancelled, `refund.processed` downgrades to free.
5. **API-side lifecycle ops** → [lib/billing/subscriptions.ts](lib/billing/subscriptions.ts) (`pauseSubscription`, `resumeSubscription`, `cancelSubscription`) are the API-route counterparts to webhook handlers — they call Razorpay + emit BillingEvent + sync Usage.

`syncUserSubscriptionState` ([lib/subscriptions/service.ts](lib/subscriptions/service.ts)) is the **only** place that mutates `Usage.plan` / `Usage.storageLimitBytes` / autopay flags. Don't bypass it.

### BillingEvent is the audit log

Every state transition emits one row to `BillingEvent` via `emitBillingEvent()` ([lib/billing/events.ts](lib/billing/events.ts)). Fire-and-forget — failures log but never block the billing op. Payload is PII-sanitized (email, phone, name, address are stripped before persistence). Event-type constants live in `BillingEventType` (keep them greppable; don't inline string literals when an existing constant fits).

### Discounts: two mechanisms, Razorpay-backed

Coupons (user enters a code) and Campaigns (auto-applied) both ultimately store a Razorpay `offer_id` matching `^offer_[A-Za-z0-9]{14}$`. Coupon wins over Campaign at checkout. The actual discount math is done by Razorpay — Xenode just picks which `offer_id` to attach. See [BILLING_OFFERS.md](BILLING_OFFERS.md).

### Refunds & support tickets

- 14-day money-back guarantee on **first payment only** ([lib/refunds/eligibility.ts](lib/refunds/eligibility.ts)).
- All refunds flow through a `SupportTicket` of category `refund_request` linked to a `RefundRequest` ([models/SupportTicket.ts](models/SupportTicket.ts), [models/RefundRequest.ts](models/RefundRequest.ts)).
- Admin approves via `/admin/dashboard/billing/refunds/[id]` → [lib/refunds/processor.ts](lib/refunds/processor.ts) calls `razorpay.payments.refund(payment_id)` + cancels the subscription.
- Razorpay has **no "refund a subscription" API** — you refund the underlying payment. Subscription refunds = refunding the activation charge.
- Insufficient Razorpay balance is treated as a **retryable** condition (stays `pending`, Payment rolled back to `success`, surfaces with a clear retry banner). Other Razorpay errors mark `RefundRequest.status = "failed"`.
- The webhook handlers for `refund.created` / `refund.processed` / `refund.failed` close the loop on `RefundRequest`.

### Plan cycle changes

- Yearly → Monthly is **always deferred to period end** (server coerces `effective: "period_end"` in `/api/subscriptions/change-plan`). Industry-standard pattern (Notion/GitHub/Slack/Vercel/etc.). The webhook `subscription.updated` reads `metadata.scheduledChange` to apply the swap on the renewal cycle.
- All other cycle changes (Monthly→Yearly, same-cycle plan changes) accept either `immediate` or `period_end`.
- The PATCH to Razorpay uses `schedule_change_at: "now"` or `"cycle_end"`.

### Cron (no background worker)

- There is **no BullMQ background worker** (removed in the monorepo migration; `bullmq`/`googleapis`/`Dockerfile.worker` deleted). Redis is used **only** for realtime Socket.IO pub/sub.
- Cron jobs are HTTP endpoints under `app/api/cron/**`, guarded by `Authorization: Bearer ${CRON_SECRET}`. The main one is `/api/cron/expire-plans` — daily midnight UTC. Separate `Dockerfile.cron`.

### Email

Resend is the single transactional provider. Auth OTPs go through better-auth's `emailOTP` plugin. Billing/support emails go through [lib/email/notifications.ts](lib/email/notifications.ts) which wraps Resend with a `safeSend` helper that swallows failures (never blocks the surrounding op). Templates in [lib/email/templates.ts](lib/email/templates.ts) match the auth OTP email's dark-mode-aware style.

### UI conventions

- **shadcn/ui** + Tailwind v4. Components in `components/ui/`. Don't re-implement primitives.
- **User dashboard** at `app/(dashboard)/dashboard/**` uses [components/dashboard/DashboardShell.tsx](components/dashboard/DashboardShell.tsx) (client component with the sidebar nav).
- **Admin dashboard** at `app/admin/dashboard/**` uses [components/admin/AdminSidebar.tsx](components/admin/AdminSidebar.tsx) — nav items have a `roles` field so super-admin-only links auto-hide for regular admins.
- The codebase ships with a known pre-existing `react-hooks/set-state-in-effect` lint error on client pages using `useEffect(() => { void load(); }, [load])`. New client list/detail pages follow the same pattern — match convention.
- The plans page (`/plans`) only fetches via the **public** endpoint `/api/admin/pricing/plans-public` — despite the URL, that route requires a *user* session, not admin. The `/admin/pricing/` prefix is historical.

### API route conventions

- Errors flow through `BillingError(status, message, code)` in [lib/billing/http.ts](lib/billing/http.ts). `jsonError(err)` converts BillingError + Razorpay SDK errors into proper HTTP responses. Use `parseJson(request, zodSchema)` for input validation.
- Idempotency: subscription mutation routes accept `Idempotency-Key` header and dedupe via [lib/billing/idempotency.ts](lib/billing/idempotency.ts).
- Razorpay SDK errors have shape `{ statusCode, error: { code, description, field } }` — use `isRazorpaySDKError(e)` from [lib/payment/razorpayUtils.ts](lib/payment/razorpayUtils.ts) to detect and surface them as 4xx with the gateway's description.

### Storage model invariants

- `StorageObject.key` is opaque (`users/{userId}/{randomHex32}`). Never derive it from a filename.
- The real filename is in `StorageObject.encryptedName` (AES-GCM). Server code must treat it as an opaque blob.
- Uploads go **directly** from the browser to Backblaze B2 (S3-compatible). The Next.js server never touches file bytes — it only signs URLs and records metadata.

## Things to be aware of

- **MongoDB Mongoose vs better-auth driver**: both use the same connection (`mongoose.connection.db` is shared with the better-auth MongoDB adapter). Don't open a second client.
- **The User model uses `collection: "user"`** (singular) to match better-auth's default. Don't pluralize it.
- **`PendingTransaction` TTL is 1 hour** (MongoDB TTL index) to limit payment callback replay windows.
- **`mongodb-memory-server`** is available for tests that need a real Mongo instance.
- **PowerShell on Windows**: this repo is developed on Windows. Use PowerShell-compatible syntax in scripts (no `&&` chains, use `;` + `if ($?)`).

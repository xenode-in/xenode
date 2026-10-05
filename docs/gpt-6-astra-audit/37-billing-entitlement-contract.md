# Canonical billing entitlement state

`syncUserSubscriptionState` is the only writer of personal Usage plan, quota,
autopay, campaign and grace state. `syncOrgSubscriptionState` owns the
corresponding organization fields and purchased seats. Byte/object counters
remain exclusively in shared storage transactions; billing never opens file
metadata or imports Vault/crypto code.

Each command runs in a shared MongoDB snapshot transaction (or joins the
refunding caller's transaction). Its Usage update, personal identity projection
and sanitized `BillingEvent` commit together. Audit failure aborts the state
change. Generic provider-operation audit calls without a transaction retain
their existing log-on-failure behavior.

## Commands and routing

- **Initialize:** Drive onboarding returns an existing Usage unchanged.
  If missing, it derives paid state from an owned subscription or initializes
  the free baseline. Organization creation initializes its free state and
  selected storage pool through the organization writer.
- **Subscription:** quotas come from the configured personal/org plan catalog;
  a missing paid plan or wrong billing account fails instead of retaining an
  old limit. Usage records the exact `subscriptionDocId`. Personal queries
  exclude organization subscriptions belonging to the same payer.
- **Admin:** manual plan assignments resolve their catalog quota and clear old
  autopay/campaign/grace state. Explicit quota overrides preserve counters.
  Missing users and attempts to replace a live provider subscription are
  refused. A manual assignment records `manualPlanAssignedAt` so callbacks from
  an earlier subscription cannot replace it. A subsequent new subscription
  clears that marker.
- **Expire:** the authenticated cron processes at most 200 due personal rows
  and 200 due organization rows per invocation, oldest expiry first. Each
  candidate is re-read in its transaction. Fresh lapses receive a deadline of
  expiry plus seven days; a delayed run does not grant another week. Existing
  failure-grace deadlines remain fixed. Expiry resets entitlement fields and
  retires only elapsed subscriptions in the same billing account.
- **Refund:** a processed full refund must match the Payment's subscription and
  billing account. Payment, that subscription and its current entitlement
  change in one transaction. Refunding an older subscription does not revoke a
  newer one. Organization refunds affect OrgUsage, not the payer's personal
  Usage. A revocation marker prevents later callbacks from regranting the
  refunded entitlement. Partial/malformed refunds fail for operator review
  rather than silently revoking a whole subscription.

Webhooks, checkout verification, reconciliation and admin cancellation share
`syncBillingSubscriptionState` to select the writer by the subscription's
recorded billing account. Personal pause/resume are scoped to personal
subscriptions. Cancellation keeps the paid period until expiry unless a
confirmed refund revokes it.

## Renewal checkpoints

`SubscriptionInvoice.usageAppliedAt` is committed with entitlement/campaign
updates. Checkout verification and charge webhooks both use this checkpoint,
including when an invoice already exists after a failed attempt. A replay of an
applied invoice cannot consume another campaign cycle or reapply an older
entitlement snapshot. Organization charges checkpoint their invoice without
touching personal campaign state. New Payments explicitly record their billing
account.

## API contract

- Drive `POST /api/onboarding/complete` returns
  `{ success: true, plan, storageLimitBytes }` for the effective Usage. It
  neither marks Accounts onboarding nor selects the account's storage pool.
- `POST /api/admin/users/{userId}/plan` accepts `plan` and optional nullable
  ISO date-time `expiresAt`. It returns the assigned plan and its dates.
- `PATCH /api/admin/users/{userId}` accepts any nonempty combination of
  `plan`, nullable ISO date-time `planExpiresAt`, nullable `storageLimitBytes`
  (null means unlimited), and `egressLimitBytes`. Quotas must be nonnegative
  safe integers. It returns `{ usage }`.
- Both admin mutations require a current Admin session, support
  `Idempotency-Key`, and return 400 for invalid input, 404 for a missing user,
  or 409 for a live-subscription/idempotency conflict. Request bodies are strict.
- Organization billing GET reads existing state or returns free defaults,
  without creating Usage, Subscription or audit rows.
- Expiry cron retains personal `grantedGraceCount` / `expiredCount` and adds
  `orgGrantedGraceCount` / `orgExpiredCount`. Repeated sweeps use the same
  recorded deadlines and preserve all storage counters.

The provider's [refund payload](https://razorpay.com/docs/webhooks/refunds)
and [subscription cancellation contract](https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription)
remain external verification requirements. Local tests mock Razorpay; no real
refund or subscription cancellation is performed during validation.

## Disposable development data

The new subscription binding, manual assignment and invoice checkpoint fields
are created by normal billing flows. There is no backfill or repair job.
Reset disposable development billing/storage data together, sign up through
Accounts and use provider test-mode checkout for new subscriptions. Never seed
a paid Usage row independently of its subscription. Real provider races,
webhook delivery, refunds and deployed cron remain release checks.

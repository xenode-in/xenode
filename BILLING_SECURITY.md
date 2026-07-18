# Billing and E2EE boundary

Billing is deliberately blind to files and keys.

## Prohibited dependencies

Code under Drive payment, subscription, refund, pricing, and admin-billing
routes must not import or query:

- Accounts `UserVault`, `SpaceProductKey`, or key-handoff records;
- `lib/crypto/**` or shared key-unwrapping helpers;
- `StorageObject.encryptedDEK`, IVs, chunk IVs, or encrypted filenames.

Billing operates on `Usage.totalStorageBytes`, `Usage.storageLimitBytes`, plan
state, and billing-domain models. It never scans file metadata to compute quota.

## Storage contract

`StorageObject.key` is opaque (`users/{accountId}/{randomHex32}`). Real names and
content types are encrypted by the browser. Subscription changes may change the
allowed byte limit; reads and deletes remain available so an over-limit user can
recover. Billing never auto-deletes encrypted files.

## Razorpay lifecycle

Xenode uses Razorpay subscriptions only. One-time order events are ignored.
Checkout resolves coupon before campaign, then records the selected Razorpay
offer ID. Webhook handlers in `lib/billing/webhooks/handlers.ts` are the
authoritative idempotent state machine. API lifecycle functions call Razorpay,
emit a sanitized `BillingEvent`, and delegate Usage changes to
`syncUserSubscriptionState`.

Refunds flow through `SupportTicket` + `RefundRequest` and refund the underlying
payment before cancellation. The 14-day guarantee applies to the first payment.

## Audit and secrets

BillingEvent payload sanitation removes names, email, phone, and addresses.
Webhook signatures use their own Razorpay secrets. Admin authentication is
separate from user Accounts/OIDC authentication.

Boundary enforcement lives in `scripts/check-boundaries.mjs` and the Drive ESLint
configuration. Any new billing route must preserve these restrictions.

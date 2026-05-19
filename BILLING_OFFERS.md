# Running Discounts on Xenode

Two mechanisms, no more. The Razorpay `offer_id` is the source of truth for
the actual discount math; Xenode just decides **which** `offer_id` to attach
to a given checkout.

| Mechanism | How it fires | Use case | Admin page |
|---|---|---|---|
| **Coupon** | User types a code at checkout | Targeted: VIPs, influencer codes, support recovery | `/admin/dashboard/coupons` |
| **Campaign** | Auto-applied to every matching checkout | Public promos: launch sales, seasonal offers | `/admin/dashboard/billing/campaigns` |

## Quick setup — running a global launch promo

1. **Razorpay Dashboard → Offers → Create New Offer** (subscription type).
   Pick percent or flat, set max discount, save. Copy the `offer_xxxxxxxxxxxxxx`
   ID — it must match `^offer_[A-Za-z0-9]{14}$`.
2. **Xenode admin → Billing → Campaigns → New Campaign**:
   - Paste the Razorpay `offer_id`
   - Set `discountPercent` to match the Razorpay offer
   - `targetAudience: "all"` (or `"free_only"` to only show on upgrades)
   - Leave `applicablePlans` / `applicableCycles` empty to apply everywhere
   - `isActive: true`, set the date window
3. Done. Every new checkout that matches will get the discount automatically.

## Quick setup — running a targeted coupon

1. **Razorpay Dashboard → Offers → Create New Offer** (subscription type),
   same as above. Copy the `offer_id`.
2. **Xenode admin → Coupons → New Coupon**:
   - Pick a `code` (e.g. `VIPLAUNCH`)
   - Paste the Razorpay `offer_id`
   - `type: "global"` (all users can enter the code, capped by `maxUses`) or
     `type: "user"` (single-recipient)
3. Hand the code to the customer. When they type it at checkout, it overrides
   any active Campaign.

## Discount resolution order in `/api/subscriptions/create`

```
if (couponCode supplied and valid)
  → use coupon.razorpayOfferId
else
  → use getActiveCampaign({ planSlug, cycle })?.razorpayOfferId
```

Coupon wins over Campaign. No third tier. See
[app/api/subscriptions/create/route.ts](app/api/subscriptions/create/route.ts).

## Prerequisites — one-time setup

Razorpay account with Subscriptions enabled, KYC complete, live API keys.
Required environment variables:

```
RAZORPAY_KEY_ID=rzp_live_xxx
RAZORPAY_KEY_SECRET=xxx
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_xxx
RAZORPAY_WEBHOOK_SECRET=xxx
RAZORPAY_SUBSCRIPTION_WEBHOOK_SECRET=xxx   # can be the same as above
```

Razorpay Dashboard → **Settings → Webhooks**:
- URL: `https://your-domain.com/api/payment/razorpay/webhook`
- Secret: matches `RAZORPAY_WEBHOOK_SECRET`
- Events to subscribe to: `subscription.authenticated`, `subscription.activated`,
  `subscription.charged`, `subscription.pending`, `subscription.halted`,
  `subscription.paused`, `subscription.resumed`, `subscription.cancelled`,
  `subscription.completed`, `subscription.updated`, `subscription.upcoming`,
  `invoice.paid`, `payment.failed`, `refund.processed`,
  `payment.dispute.created`, `payment.dispute.lost`, `payment.dispute.won`.

## What you don't need

These no longer exist (use Campaign or Coupon instead):

- ~~SubscriptionOffer model + `/admin/dashboard/subscriptions/offers`~~ — collapsed into Campaign.
- ~~`PricingConfig.campaign` embedded field~~ — Campaigns live in their own collection.
- ~~Billing Simulator~~ — removed.

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `The offer id must be 20 characters.` | Razorpay `offer_id` malformed | Re-copy from Razorpay dashboard; must match `^offer_[A-Za-z0-9]{14}$` |
| `This coupon's offer is misconfigured. Please contact support.` | Coupon row has bad `razorpayOfferId` | Edit the coupon, paste a valid id |
| User-visible price doesn't show discount | Campaign `applicablePlans` excludes this plan, or `isActive: false`, or outside the date window | Check the Campaign row in admin |

## File references

- Route: [app/api/subscriptions/create/route.ts](app/api/subscriptions/create/route.ts)
- Campaign resolution: [lib/billing/campaigns.ts](lib/billing/campaigns.ts)
- Coupon validation: [lib/billing/coupons.ts](lib/billing/coupons.ts)
- Webhook handlers: [lib/billing/webhooks/handlers.ts](lib/billing/webhooks/handlers.ts)
- Offer ID format validator: [lib/payment/razorpayUtils.ts](lib/payment/razorpayUtils.ts)

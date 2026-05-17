# Subscription Offers — How They Work

A practical guide to running discounted subscriptions on Xenode: how the moving
parts fit together, what to click in the Razorpay Dashboard, what to configure
in our admin, and how a customer's checkout actually plays out.

> **Mental model in one line:** Razorpay does the discount math; Xenode just
> routes the right `offer_id` to the right subscription.

---

## 1. The three layers

| Layer | What lives there | API or UI? |
| --- | --- | --- |
| **Razorpay Dashboard** | The Plan, the Offer (discount %/flat + cycles), the `offer_id` | UI only for subscription offers |
| **Xenode admin** | The mapping: which `offer_id` should apply, to whom, when, on which plan | UI + API |
| **Xenode code** | `POST /api/subscriptions/create` resolves coupon → campaign → no offer and passes `offer_id` to Razorpay | API |

You only ever do **the dashboard step once per promo**. Everything else after
that is reusable.

---

## 2. Prerequisites — one-time setup

### 2.1 Razorpay account in subscription mode

You need a Razorpay account with **Subscriptions** enabled. KYC must be
complete and you need API keys (test + live).

Required environment variables (already in `.env`):

```bash
RAZORPAY_KEY_ID=rzp_test_xxx
RAZORPAY_KEY_SECRET=xxx
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxx
RAZORPAY_WEBHOOK_SECRET=xxx
RAZORPAY_SUBSCRIPTION_WEBHOOK_SECRET=xxx   # can be the same as above
```

### 2.2 Webhook endpoint registered

Razorpay Dashboard → **Settings → Webhooks** → add:

- **URL:** `https://your-domain.com/api/payment/razorpay/webhook`
- **Secret:** matches `RAZORPAY_WEBHOOK_SECRET`
- **Events to subscribe to** (all of these must be ticked):
  - `subscription.authenticated`
  - `subscription.activated`
  - `subscription.charged`
  - `subscription.updated`
  - `subscription.pending`
  - `subscription.halted`
  - `subscription.paused`
  - `subscription.resumed`
  - `subscription.cancelled`
  - `subscription.completed`
  - `payment.failed`
  - `refund.processed`
  - `payment.dispute.created`

### 2.3 Plans created in Razorpay and mapped in Xenode

For every (plan slug × billing cycle) the user can subscribe to, a matching
Razorpay plan must exist and its `plan_id` must be stored on the Xenode plan.

**In Razorpay Dashboard:** Subscriptions → Plans → **Create Plan**. Set
frequency (monthly / quarterly / yearly), interval, amount, currency = INR.
Razorpay returns an id like `plan_OqW3kLm9Xh2bzA`.

**In Xenode:** admin → **Sub Plans** (or edit `PricingConfig` directly). For
each plan's `pricing[].razorpayPlanId`, paste the id.

```js
// PricingConfig.plans[2].pricing = [
//   { cycle: "monthly",   priceINR: 699,  razorpayPlanId: "plan_OqW3kLm9Xh2bzA" },
//   { cycle: "yearly",    priceINR: 6990, razorpayPlanId: "plan_PpZ2nKx4Wm1cyB" },
// ]
```

Without this mapping our `/api/subscriptions/create` throws a 400 because it
has nothing to pass as `plan_id`.

---

## 3. Creating an Offer — Razorpay Dashboard

Razorpay does not expose a public API to create *subscription-eligible* offers.
You must use the dashboard for this single step.

**Dashboard path:** Subscriptions → **+ Create New Offer** → select **Offers on
Subscriptions**.

The form has five tabs.

### Tab 1 — Description

| Field | What it does |
| --- | --- |
| Offer Name | Internal label (e.g. *Launch — First month ₹99*) |
| Display Text | What the customer sees on Razorpay's authorisation page (e.g. *First month for ₹99*) |
| Terms | Fine print also shown on the auth page |

### Tab 2 — Discount Type

| Field | Options |
| --- | --- |
| Redemption Type | **Single Use** (1 cycle), **Limited number of cycles** (N), **Forever** (all cycles) |
| Discount Type | **Flat** or **Percentage** |
| Discount Value | Flat amount (INR) or percent (1-99) |

> **Translating intent to fields:**
> - "First month ₹99, then ₹699" → Flat ₹600 off, Redemption: Single Use
> - "50% off for 3 months" → Percentage 50%, Limited number of cycles: 3
> - "20% off forever (loyalty)" → Percentage 20%, Redemption: Forever
> - "Free first month" → Flat = plan price, Redemption: Single Use

### Tab 3 — Applicable On

| Field | Notes |
| --- | --- |
| Payment Method | UPI, Card, or both — restricts the offer to that rail |
| Card details | If Card: type (credit/debit), network, issuer, max usage per card, IINs |
| **Linked Plans** | Tick every Razorpay plan this offer should apply to |

If the customer picks a plan that **isn't ticked**, Razorpay silently ignores
the offer. This is the #1 cause of "offer didn't apply" tickets.

### Tab 4 — Offer Validity

| Field | Notes |
| --- | --- |
| Starting On | When customers can start using it (now or future date) |
| Expires On | When new sign-ups stop getting it |
| On Payment Failure | "Allow payment without offer" (recommended) or "Block payment" |

### Tab 5 — Review & Create

Confirm and submit. Razorpay returns a 20-character id like
`offer_OqXyZ7vM3kLb8N`. **Copy it.**

> Our `isValidRazorpayOfferId` validator enforces `^offer_[A-Za-z0-9]{14}$`.
> If you ever paste an id of different length, the admin form rejects it.

---

## 4. Attaching the offer — Xenode admin

You have three places to attach an `offer_id`. They differ in **who gets it**
and **how it's applied**.

| Surface | Audience | Trigger | Use for |
| --- | --- | --- | --- |
| **Campaign** | Everyone whose plan + cycle + cohort matches | Auto, at checkout | Launches, holiday sales, public promos |
| **Coupon** | Only customers who type the code | Manual, at checkout | Influencer codes, retention offers, partner deals |
| **SubscriptionOffer** | Everyone | Auto, at checkout | Legacy single-active-offer surface — prefer Campaign |

Resolution priority at checkout: **Coupon > Campaign > SubscriptionOffer > no offer**.

### 4.1 Campaign (preferred for public promos)

Admin → **Campaigns** → **New campaign**.

Fields that matter:

| Field | Example | Notes |
| --- | --- | --- |
| `name` | Launch first month ₹99 | Internal |
| `slug` | launch-first-month | URL-safe, unique |
| `discountPercent` | 86 | **Display only** for the "Save 86%" badge. Real discount comes from the Razorpay offer. |
| `duration` | limited | `forever` or `limited` |
| `cycles` | 1 | Required when limited |
| `applicablePlans` | `["plus"]` | Empty array = all plans |
| `applicableCycles` | `["monthly"]` | Empty array = all cycles |
| `targetAudience` | `all` | `all` / `free_only` / `plan:<slug>` |
| `razorpayOfferId` | `offer_OqXyZ7vM3kLb8N` | **The 20-char id from Step 3** |
| `priority` | 100 | Lower wins when multiple campaigns match |
| `startsAt` / `endsAt` | dates | Independent of Razorpay's own validity, both must allow |
| `maxRedemptions` | 500 or blank | Stops auto-applying after N redemptions |

After creation, anyone visiting `/checkout?plan=plus&cycle=monthly` between
`startsAt` and `endsAt` automatically gets the offer attached.

### 4.2 Coupon (preferred for codes)

Admin → **Coupons** → **New coupon**.

| Field | Example |
| --- | --- |
| `code` | LAUNCH99 |
| `discountType` / `discountValue` | percent / 86 (display-only) |
| `applicablePlans` | `["plus"]` |
| `validFrom` / `validTo` | dates |
| `maxUses` | 500 (0 = unlimited) |
| `perUserLimit` | 1 |
| `razorpayOfferId` | `offer_OqXyZ7vM3kLb8N` |

Customer enters `LAUNCH99` in the coupon box at checkout. Our code validates
the coupon, then passes its `razorpayOfferId` to Razorpay.

### 4.3 SubscriptionOffer (legacy)

Admin → **Sub Offers** → **Create offer**. Same idea as Campaign but only one
can be active at a time. Kept for backwards compatibility; prefer Campaign.

---

## 5. What happens at checkout — the code path

Source: [app/api/subscriptions/create/route.ts](app/api/subscriptions/create/route.ts).

```ts
// 1. Validate body, check idempotency, ensure no existing active sub
// 2. Resolve discount:
//    a) coupon code (if provided)
if (input.couponCode) {
  const coupon = await validateCoupon({ code, userId, planSlug, requireRazorpayOffer: true });
  offerId = coupon.razorpayOfferId;   // must pass format validation
  offerSource = "coupon";
}

//    b) campaign / subscription-offer fallback
if (!offerId) {
  const activeOffer = await getActiveSubscriptionOffer();
  if (isValidRazorpayOfferId(activeOffer?.razorpayOfferId)) {
    offerId = activeOffer.razorpayOfferId;
    offerSource = "campaign";
  }
}

// 3. Call Razorpay
await razorpay.subscriptions.create({
  plan_id: planContext.pricingEntry.razorpayPlanId,
  total_count: 360,                  // monthly: max 360
  quantity: 1,
  customer_notify: true,             // boolean per current docs
  offer_id: offerId,                 // omitted if no offer
  notes: { userId, planSlug, ... },  // empty values stripped
});

// 4. Persist Subscription row, emit subscription.created BillingEvent
// 5. Return { subscriptionId, shortUrl, amount } to the client
```

Razorpay then:

1. Returns a `subscription_id` (`sub_xxx`) and `short_url`.
2. Our SubscribeButton opens Razorpay's hosted authorisation page.
3. The page shows the discount inline:
   > Pay **₹99** today, then **₹699 / month** from cycle 2
4. Customer enters UPI ID / card, approves the mandate.
5. Razorpay charges ₹99, fires `subscription.authenticated` →
   `subscription.activated` → `subscription.charged`.
6. Our webhook handler creates a `SubscriptionInvoice` numbered
   `XEN-2026-00042` for ₹99 and emits a `subscription.charged` BillingEvent.
7. **30 days later** Razorpay auto-charges ₹699. Another `subscription.charged`
   fires. Another invoice (`XEN-2026-00043`) is created at the real ₹699
   amount. The offer has been "consumed" — every subsequent cycle is full price.

---

## 6. Real-world recipes

Each recipe lists the Razorpay offer config + the Xenode attachment. The
display-only `discountPercent` is what shows up on the pricing page badge.

### 6.1 Launch promo: ₹99 first month, then ₹699

**Razorpay offer:**
- Discount Type: **Flat ₹600**
- Redemption: **Single Use**
- Linked Plans: Plus Monthly (`plan_OqW3kLm9Xh2bzA`)
- Validity: today → 30 days
- Payment Method: UPI + Card

**Xenode Campaign:**
```yaml
name: "Launch first month ₹99"
slug: "launch-first-month-99"
discountPercent: 86            # display only
duration: "limited"
cycles: 1
applicablePlans: ["plus"]
applicableCycles: ["monthly"]
targetAudience: "all"
razorpayOfferId: "offer_OqXyZ7vM3kLb8N"
priority: 100
startsAt: 2026-01-15
endsAt: 2026-02-15
badge: "LAUNCH"
```

### 6.2 50% off for 3 months across all plans

**Razorpay offer:**
- Discount Type: **Percentage 50%**
- Redemption: **Limited number of cycles**, value 3
- Linked Plans: tick **every** monthly plan (Basic, Pro, Plus, Max)

**Xenode Campaign:**
```yaml
name: "Half off your first quarter"
slug: "half-off-q1"
discountPercent: 50
duration: "limited"
cycles: 3
applicablePlans: []            # empty = all
applicableCycles: ["monthly"]
razorpayOfferId: "offer_RyZbX5kV2mLnA8"
priority: 50                   # high priority — overrides others
```

### 6.3 Forever loyalty discount: 20% off for existing free users

**Razorpay offer:**
- Discount Type: **Percentage 20%**
- Redemption: **Forever**
- Linked Plans: Pro Monthly + Pro Yearly

**Xenode Campaign:**
```yaml
name: "Free-to-Pro loyalty"
slug: "free-to-pro-loyalty"
discountPercent: 20
duration: "forever"
targetAudience: "free_only"    # only free-tier users see this
applicablePlans: ["pro"]
razorpayOfferId: "offer_SaTcWp6lU3nQ9b"
```

### 6.4 Influencer code: free first month with `CREATOR100`

**Razorpay offer:**
- Discount Type: **Flat ₹699** (equals plan price)
- Redemption: Single Use
- Linked Plans: Plus Monthly

**Xenode Coupon:**
```yaml
code: "CREATOR100"
discountType: "percent"
discountValue: 100
applicablePlans: ["plus"]
maxUses: 1000
perUserLimit: 1
razorpayOfferId: "offer_TbUdXq7mV4oR0c"
validFrom: 2026-01-01
validTo: 2026-03-31
```

### 6.5 Black Friday — 30% off, monthly + yearly, capped

**Razorpay offer:**
- Discount Type: **Percentage 30%**
- Redemption: Single Use (or up to N cycles for an "annual special")
- Linked Plans: all plans, both monthly and yearly

**Xenode Campaign:**
```yaml
name: "Black Friday 2026"
slug: "bf-2026"
discountPercent: 30
duration: "limited"
cycles: 1
applicablePlans: []
applicableCycles: ["monthly", "yearly"]
razorpayOfferId: "offer_UcVeYr8nW5pS1d"
priority: 10                   # beat any other campaign
maxRedemptions: 5000
badge: "BLACK FRIDAY"
startsAt: 2026-11-25
endsAt: 2026-11-30
```

---

## 7. Testing the full loop

Use Razorpay **test mode** (`rzp_test_xxx` keys).

1. Create a **test plan** in the dashboard (toggle "Test Mode" top right).
2. Update `PricingConfig.plans[].pricing[].razorpayPlanId` to the test plan id.
3. Create a **test offer** linked to that test plan, with 80% off for 1 cycle.
4. Create a Campaign in admin pointing at the test offer id.
5. Visit `/checkout?plan=plus&cycle=monthly` as a test user.
6. Click **Subscribe**. Razorpay's authorisation page should show the
   discounted amount inline.
7. Authorise with a **test UPI ID** or **4111 1111 1111 1111** test card.
8. Verify in:
   - Razorpay Dashboard → Subscriptions → the new sub shows `offer_id` attached
   - Admin → Subscriptions → row shows `offerApplied: true`
   - Admin → Audit Log → a `subscription.created` event with
     `offerSource: "campaign"`, plus an incoming `subscription.charged` event
   - Admin → Webhooks → both events recorded with `status: processed`
   - Your test user's billing dashboard → invoice `XEN-2026-00001` at the
     discounted amount

---

## 8. Common errors and what they mean

| Error from `/api/subscriptions/create` | Cause | Fix |
| --- | --- | --- |
| `The offer id must be 20 characters.` (proxied 400) | `razorpayOfferId` malformed | Re-copy the id from Razorpay dashboard (must match `^offer_[A-Za-z0-9]{14}$`) |
| `This coupon's offer is misconfigured. Please contact support.` (400) | Coupon row has bad offer id | Edit the coupon, paste a valid id |
| `An active or pending subscription already exists` (409) | User already has a sub | Cancel current sub via admin or `/api/subscriptions/cancel` |
| `Recurring plan is not configured for this billing cycle` (400) | `PricingConfig.plans[].pricing[].razorpayPlanId` missing | Create the Razorpay plan, paste id |
| Authorisation page shows full price instead of discount | The Razorpay offer isn't linked to the picked plan | Edit offer in dashboard, tick the missing plan |
| Offer applied but customer charged full price on first cycle | Offer expired between checkout and authorisation | Extend offer validity or create a new offer |

Watch the **Audit Log** (`/admin/dashboard/billing/audit`) — every offer
resolution emits an event. A `campaign.invalid_offer_id` row means our code
**skipped** a misconfigured campaign offer at checkout; the customer paid full
price but the subscription was created successfully.

---

## 9. Limitations worth knowing

1. **One offer per subscription.** Razorpay's `subscriptions.create` accepts a
   single `offer_id`. Stacking a coupon and a campaign on one subscription is
   not possible — coupon wins.

2. **`discountPercent` on Campaign / Coupon is display-only.** The actual
   charge is whatever the Razorpay offer says. Keep both in sync when you
   create the promo — there's no automatic check.

3. **Razorpay decides which cycles get discounted** via the offer's
   `no_of_cycles` setting (Redemption Type on the form). Xenode cannot
   override this per-customer.

4. **Subscription offers are dashboard-only.** Razorpay does not currently
   expose a public API to create offers with `applicable_on: "subscription"`.
   Plan creation, subscription creation, offer linking are all API-driven —
   just not offer creation itself.

5. **UPI Autopay max amount** is set when the customer authorises the mandate.
   If you later run a campaign that brings a cycle above the original mandate
   limit, the charge will fail. For aggressive upgrades, prefer
   `change-plan` flow with `period_end` so the customer re-authorises.

6. **Offer redemptions are tracked by Razorpay**, not us. Our
   `Campaign.redeemedCount` only ticks when our `subscription.charged` handler
   sees an offer was applied — which means it lags Razorpay by one webhook
   round trip. Use Razorpay's dashboard analytics for authoritative counts.

---

## 10. Quick checklist for any new offer

1. ☐ Razorpay plan(s) created and `plan_id` recorded in Xenode `PricingConfig`
2. ☐ Razorpay offer created with **Payment Method = Subscription**
3. ☐ Offer **linked to all relevant Razorpay plans**
4. ☐ Offer's **Redemption Type / No. of Cycles** matches the intent
5. ☐ Offer's **Validity window** covers the promo period
6. ☐ Copied `offer_xxxxxxxxxxxxxx` (exactly 20 chars)
7. ☐ Pasted into Campaign / Coupon / SubscriptionOffer in Xenode admin
8. ☐ `Campaign.discountPercent` matches the actual Razorpay discount
   (for accurate badge display)
9. ☐ Tested end-to-end in Razorpay test mode
10. ☐ Verified the resulting `Subscription` row has `offerApplied: true` and
    the BillingEvent audit has the right `offerSource`

---

## File references

- Route: [app/api/subscriptions/create/route.ts](app/api/subscriptions/create/route.ts) — offer resolution & subscription creation
- Webhook handlers: [lib/billing/webhooks/handlers.ts](lib/billing/webhooks/handlers.ts) — `subscription.charged`, `subscription.updated`, etc.
- Offer-id format validator: [lib/payment/razorpayUtils.ts](lib/payment/razorpayUtils.ts) — `isValidRazorpayOfferId`
- Zod schemas: [lib/billing/validation/schemas.ts](lib/billing/validation/schemas.ts) — `razorpayOfferIdSchema`
- Campaign model: [models/Campaign.ts](models/Campaign.ts)
- Coupon model: [models/Coupon.ts](models/Coupon.ts)
- SubscriptionOffer model (legacy): [models/SubscriptionOffer.ts](models/SubscriptionOffer.ts)
- Campaign admin: [app/admin/dashboard/billing/campaigns/page.tsx](app/admin/dashboard/billing/campaigns/page.tsx)
- Coupon admin: [app/admin/dashboard/coupons/page.tsx](app/admin/dashboard/coupons/page.tsx)
- SubscriptionOffer admin: [app/admin/dashboard/subscriptions/offers/page.tsx](app/admin/dashboard/subscriptions/offers/page.tsx)
- Audit log viewer: [app/admin/dashboard/billing/audit/page.tsx](app/admin/dashboard/billing/audit/page.tsx)

---

## Razorpay docs referenced

- [Subscriptions Overview](https://razorpay.com/docs/api/payments/subscriptions/)
- [Create a Subscription](https://razorpay.com/docs/api/payments/subscriptions/create-subscription/)
- [Update a Subscription](https://razorpay.com/docs/api/payments/subscriptions/update-subscription/)
- [Pause a Subscription](https://razorpay.com/docs/api/payments/subscriptions/pause-subscription/)
- [Cancel a Subscription](https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription/)
- [Subscription Offers — Overview](https://razorpay.com/docs/subscriptions/offers/)
- [Create Subscription Offers (dashboard)](https://razorpay.com/docs/payments/subscriptions/offers/create/)
- [Link an Offer to a Subscription](https://razorpay.com/docs/payments/subscriptions/offers/link/)
- [Subscription Webhooks](https://razorpay.com/docs/webhooks/payloads/subscriptions/)

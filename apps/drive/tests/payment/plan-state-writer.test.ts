import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";
import OrgUsage from "@/models/OrgUsage";
import Subscription from "@/models/Subscription";
import SubscriptionInvoice from "@/models/SubscriptionInvoice";
import Payment from "@/models/Payment";
import BillingEvent from "@/models/BillingEvent";
import { ensureUserUsage, syncUserSubscriptionState } from "@/lib/subscriptions/service";
import { syncOrgSubscriptionState } from "@/lib/orgs/billing/service";
import { dispatchWebhookEvent } from "@/lib/billing/webhooks/handlers";
import { requireAuth, getServerSession } from "@/lib/auth/session";
import { getAdminSession } from "@/lib/admin/session";
import { POST as onboarding } from "@/app/api/onboarding/complete/route";
import { POST as adminPlan } from "@/app/api/admin/users/[userId]/plan/route";
import { PATCH as adminUsage } from "@/app/api/admin/users/[userId]/route";
import { GET as orgBilling } from "@/app/api/orgs/[orgId]/billing/route";
import { GET as expirePlans } from "@/app/api/cron/expire-plans/route";
import { getPlanBySlugFromDB } from "@/lib/config/getPricingConfig";
import { findActiveSubscription } from "@/lib/billing/subscriptions";
import { POST as adminCancel } from "@/app/api/admin/subscriptions/[id]/cancel/route";
import { GET as reconcileSubscriptions } from "@/app/api/cron/reconcile-subscriptions/route";
import razorpay from "@/lib/razorpay";
import { SUBSCRIPTION_GRACE_PERIOD_MS } from "@/lib/subscriptions/constants";

vi.mock("@/lib/admin/session", () => ({ getAdminSession: vi.fn() }));
vi.mock("@/lib/razorpay", () => ({ default: { subscriptions: {
  cancel: vi.fn(async () => ({})), fetch: vi.fn(),
} } }));
vi.mock("@/lib/email/notifications", () => ({ notifyRefundCompleted: vi.fn() }));

const request = (path: string, body?: unknown, key?: string) => new NextRequest(`http://localhost${path}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { "content-type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const params = (userId: string) => ({ params: Promise.resolve({ userId }) });
async function user(stringId = false) {
  const id = new mongoose.Types.ObjectId().toHexString();
  await mongoose.connection.collection<{ _id: string | mongoose.Types.ObjectId; name: string; email: string }>("user").insertOne({
    _id: stringId ? id : new mongoose.Types.ObjectId(id),
    name: "Billing test", email: `${id}@example.test`,
  });
  return id;
}
async function subscription(userId: string, accountId = userId, org = false) {
  return Subscription.create({
    userId, accountId, planSlug: org ? "org-team" : "pro", status: "active",
    subscription_id: `sub_${new mongoose.Types.ObjectId()}`,
    billingCycle: "monthly", startDate: new Date(), endDate: new Date(Date.now() + 30 * 86400_000),
    autoRenew: true, metadata: { basePlanAmountINR: 499, basePlanAmount: 49900 },
  });
}
async function activate(sub: Awaited<ReturnType<typeof subscription>>) {
  return syncUserSubscriptionState({ userId: sub.userId, subscriptionDocId: sub._id,
    status: "active", expiresAt: sub.endDate, autopayActive: true });
}
async function refund(sub: Awaited<ReturnType<typeof subscription>>, amount = 49900) {
  const paymentId = `pay_${new mongoose.Types.ObjectId()}`;
  const payment = await Payment.create({ userId: sub.userId, accountId: sub.accountId,
    amount: 499, status: "success", txnid: paymentId, payment_id: paymentId,
    order_id: sub.subscription_id, planName: sub.planSlug });
  const result = await dispatchWebhookEvent({
    eventId: `evt_${paymentId}`, eventType: "refund.processed", source: "razorpay_subscription",
    event: { payload: { refund: { entity: { id: `rfnd_${paymentId}`, payment_id: paymentId, amount } } } },
  });
  return { payment, result };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("canonical billing entitlement writes", () => {
  it("repeated onboarding preserves a paid plan, byte counters and its expiry", async () => {
    const userId = await user();
    const sub = await subscription(userId);
    await activate(sub);
    await Usage.updateOne({ userId }, { $set: { totalStorageBytes: 123, totalObjects: 7 } });
    vi.mocked(requireAuth).mockResolvedValue({ user: { id: userId } } as never);
    const before = await Usage.findOne({ userId }).lean();
    expect((await onboarding(request("/api/onboarding/complete", {}))).status).toBe(200);
    const after = await Usage.findOne({ userId }).lean();
    expect(after).toEqual(before);
    expect(await BillingEvent.countDocuments()).toBe(1);
  });

  it("gives an account arriving from Accounts onboarding its free entitlement once", async () => {
    const userId = await user();
    await ensureUserUsage(userId);
    const usage = await Usage.findOne({ userId }).lean();
    expect(usage).toMatchObject({ plan: "free", storageLimitBytes: FREE_TIER_LIMIT_BYTES, totalStorageBytes: 0 });
    await Usage.updateOne({ userId }, { $set: { totalStorageBytes: 42 } });
    await ensureUserUsage(userId);
    expect((await Usage.findOne({ userId }).lean())?.totalStorageBytes).toBe(42);
    expect(await Usage.countDocuments({ userId })).toBe(1);
    expect(await BillingEvent.countDocuments()).toBe(1);
  });

  it("initializes a missing Usage from the owned paid subscription", async () => {
    const userId = await user();
    const sub = await subscription(userId);
    const { usage } = await syncUserSubscriptionState({ userId, action: "initialize" });
    expect(usage?.plan).toBe("pro");
    expect(String(usage?.subscriptionDocId)).toBe(String(sub._id));
    expect(usage?.storageLimitBytes).toBe(500 * 1024 ** 3);
  });

  it("does not let concurrent onboarding replace paid activation", async () => {
    const userId = await user();
    const sub = await subscription(userId);
    await getPlanBySlugFromDB("pro");
    await Promise.all([syncUserSubscriptionState({ userId, action: "initialize" }), activate(sub)]);
    expect((await Usage.findOne({ userId }))?.plan).toBe("pro");
    expect(await Usage.countDocuments({ userId })).toBe(1);
  });

  it("uses the existing grace deadline, and delayed expiry does not grant a new week", async () => {
    const userId = await user();
    const expiry = new Date(Date.now() - SUBSCRIPTION_GRACE_PERIOD_MS - 1000);
    await Usage.create({ userId, plan: "pro", planExpiresAt: expiry, totalStorageBytes: 123 });
    const result = await syncUserSubscriptionState({ userId, action: "expire", now: new Date() });
    expect(result.outcome).toBe("expired");
    expect(result.usage?.plan).toBe("free");
    expect(result.usage?.totalStorageBytes).toBe(123);
  });

  it("rechecks a renewed plan instead of expiring a stale cron candidate", async () => {
    const userId = await user();
    const sub = await subscription(userId);
    await Usage.create({ userId, plan: "pro", planExpiresAt: new Date(0) });
    await activate(sub);
    expect((await syncUserSubscriptionState({ userId, action: "expire", now: new Date() })).outcome).toBe("unchanged");
    expect((await Subscription.findById(sub._id))?.status).toBe("active");
  });

  it("records the fixed grace deadline and treats a repeat as no new transition", async () => {
    const userId = await user();
    const expiry = new Date(Date.now() - 1000);
    await Usage.create({ userId, plan: "pro", planExpiresAt: expiry });
    await syncUserSubscriptionState({ userId, action: "expire", now: new Date() });
    await syncUserSubscriptionState({ userId, action: "expire", now: new Date() });
    expect((await Usage.findOne({ userId }))?.gracePeriodEndsAt?.getTime()).toBe(expiry.getTime() + SUBSCRIPTION_GRACE_PERIOD_MS);
    expect(await BillingEvent.countDocuments()).toBe(1);
  });

  it("rolls back Usage and the adapter-shaped user projection when its audit fails", async () => {
    const userId = await user(true);
    const sub = await subscription(userId);
    vi.spyOn(BillingEvent, "create").mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(activate(sub)).rejects.toThrow("audit unavailable");
    expect(await Usage.countDocuments()).toBe(0);
    const identity = await mongoose.connection.collection("user").findOne({ email: `${userId}@example.test` });
    expect(identity?.subscriptionStatus).toBeUndefined();
  });

  it("rejects a subscription from another account or an organization", async () => {
    const userId = await user();
    const other = await subscription(await user());
    await expect(syncUserSubscriptionState({ userId, subscriptionDocId: other._id, status: "active", expiresAt: other.endDate }))
      .rejects.toMatchObject({ code: "subscription_scope" });
    const org = await subscription(userId, "org:one", true);
    await expect(activate(org)).rejects.toMatchObject({ code: "subscription_scope" });
    expect(await Usage.countDocuments()).toBe(0);
  });

  it("requires a configured paid plan and never retains an old quota for an unknown plan", async () => {
    const userId = await user();
    const sub = await subscription(userId);
    sub.planSlug = "unconfigured";
    await sub.save();
    await expect(activate(sub)).rejects.toMatchObject({ code: "invalid_plan" });
    expect(await Usage.countDocuments()).toBe(0);
  });

  it("deduplicates campaign consumption by invoice, including an old invoice replay after a new charge", async () => {
    const userId = await user();
    const sub = await subscription(userId);
    await activate(sub);
    await Usage.updateOne({ userId }, { $set: { campaignType: "limited", campaignCyclesLeft: 2 } });
    const invoice = async (id: string) => SubscriptionInvoice.create({ subscription_id: sub.subscription_id,
      payment_id: id, amount: 499, status: "paid", billing_date: new Date() });
    const first = await invoice("pay_first");
    const second = await invoice("pay_second");
    const renew = (invoiceId: mongoose.Types.ObjectId) => syncUserSubscriptionState({
      userId, subscriptionDocId: sub._id, status: "active", expiresAt: sub.endDate, renewal: { invoiceId },
    });
    await renew(first._id as mongoose.Types.ObjectId);
    expect((await Usage.findOne({ userId }))?.campaignCyclesLeft).toBe(1);
    await renew(first._id as mongoose.Types.ObjectId);
    expect((await Usage.findOne({ userId }))?.campaignCyclesLeft).toBe(1);
    await renew(second._id as mongoose.Types.ObjectId);
    await renew(first._id as mongoose.Types.ObjectId);
    const usage = await Usage.findOne({ userId });
    expect(usage?.campaignType).toBeNull();
    expect(usage?.lastRenewalTxnid).toBe("pay_second");
    expect((await SubscriptionInvoice.findById(first._id))?.usageAppliedAt).toBeInstanceOf(Date);
  });

  it("a plan applied by subscription.updated takes its quota and its price", async () => {
    const userId = await user();
    const sub = await subscription(userId);
    await activate(sub);
    const plus = await getPlanBySlugFromDB("plus");
    const plusMonthly = plus!.pricing.find((entry) => entry.cycle === "monthly")!;
    const result = await dispatchWebhookEvent({
      eventId: `evt_update_${sub.subscription_id}`, eventType: "subscription.updated", source: "razorpay_subscription",
      event: { payload: { subscription: { entity: { id: sub.subscription_id, plan_id: plusMonthly.razorpayPlanId } } } },
    });
    expect(result.status).toBe("processed");
    const updated = await Subscription.findById(sub._id).lean();
    expect(updated?.planSlug).toBe("plus");
    // The billing page's "Next charge" reads these.
    expect(updated?.metadata).toMatchObject({ basePlanAmount: plusMonthly.priceINR * 100, planName: plus!.name });
    expect((await Usage.findOne({ userId }))?.storageLimitBytes).toBe(plus!.storageLimitBytes);
  });

  it("refunds the bound subscription, keeps byte counters and does not refund twice", async () => {
    const sub = await subscription(await user());
    await activate(sub);
    await Usage.updateOne({ userId: sub.userId }, { $set: { totalStorageBytes: 456 } });
    const { payment, result } = await refund(sub);
    expect(result.status).toBe("processed");
    const usage = await Usage.findOne({ userId: sub.userId });
    expect(usage?.plan).toBe("free");
    expect(usage?.storageLimitBytes).toBe(FREE_TIER_LIMIT_BYTES);
    expect(usage?.totalStorageBytes).toBe(456);
    expect(usage?.autopayActive).toBe(false);
    expect((await Subscription.findById(sub._id))?.status).toBe("cancelled");
    expect((await Payment.findById(payment._id))?.status).toBe("refunded");
    const replay = await dispatchWebhookEvent({ eventId: "refund_replay", eventType: "refund.processed",
      source: "razorpay_subscription", event: { payload: { refund: { entity: {
        id: `rfnd_${payment.payment_id}`, payment_id: payment.payment_id, amount: 49900,
      } } } } });
    expect(replay.status).toBe("processed");
    await activate(sub);
    expect((await Usage.findOne({ userId: sub.userId }))?.plan).toBe("free");
  });

  it("an older refund leaves the newer paid subscription and entitlement intact", async () => {
    const userId = await user();
    const old = await subscription(userId);
    const current = await subscription(userId);
    await activate(current);
    expect((await refund(old)).result.status).toBe("processed");
    expect(String((await Usage.findOne({ userId }))?.subscriptionDocId)).toBe(String(current._id));
    expect((await Subscription.findById(current._id))?.status).toBe("active");
    expect((await Subscription.findById(old._id))?.status).toBe("cancelled");
    await activate(old);
    expect(String((await Usage.findOne({ userId }))?.subscriptionDocId)).toBe(String(current._id));
  });

  it("organization refunds revoke only the organization entitlement", async () => {
    const userId = await user();
    const personal = await subscription(userId);
    await activate(personal);
    const org = await subscription(userId, "org:one", true);
    await syncOrgSubscriptionState({ orgId: "one", subscriptionDocId: org._id,
      status: "active", expiresAt: org.endDate, seats: 20 });
    expect((await refund(org)).result.status).toBe("processed");
    expect((await OrgUsage.findOne({ orgId: "one" }))?.plan).toBe("org-free");
    expect((await Usage.findOne({ userId }))?.plan).toBe("pro");
  });

  it("rejects a partial refund without changing Payment or entitlement", async () => {
    const sub = await subscription(await user());
    await activate(sub);
    const { payment, result } = await refund(sub, 100);
    expect(result.status).toBe("failed");
    expect((await Payment.findById(payment._id))?.status).toBe("success");
    expect((await Usage.findOne({ userId: sub.userId }))?.plan).toBe("pro");
  });

  it("refund audit failure rolls Payment, Subscription and Usage back together", async () => {
    const sub = await subscription(await user());
    await activate(sub);
    vi.spyOn(BillingEvent, "create").mockRejectedValueOnce(new Error("audit unavailable"));
    const { payment, result } = await refund(sub);
    expect(result.status).toBe("failed");
    expect((await Payment.findById(payment._id))?.status).toBe("success");
    expect((await Subscription.findById(sub._id))?.status).toBe("active");
    expect((await Usage.findOne({ userId: sub.userId }))?.plan).toBe("pro");
  });

  it("admin assignment resolves the quota, preserves counters and deduplicates retries", async () => {
    const userId = await user();
    await Usage.create({ userId, totalStorageBytes: 321 });
    vi.mocked(getAdminSession).mockResolvedValue({ id: "admin_1", role: "admin" } as never);
    const call = () => adminPlan(request("/admin/plan", { plan: "pro" }, "same-key"), params(userId));
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const usage = await Usage.findOne({ userId });
    expect(usage?.storageLimitBytes).toBe(500 * 1024 ** 3);
    expect(usage?.totalStorageBytes).toBe(321);
    expect(await BillingEvent.countDocuments()).toBe(1);
    expect((await BillingEvent.findOne())?.actorId).toBe("admin_1");
  });

  it("both admin routes reject invalid dates and unsafe quotas before writes", async () => {
    const userId = await user();
    vi.mocked(getAdminSession).mockResolvedValue({ id: "admin_1" } as never);
    expect((await adminPlan(request("/admin/plan", { plan: "pro", expiresAt: "bad-date" }), params(userId))).status).toBe(400);
    expect((await adminUsage(request("/admin/usage", { storageLimitBytes: Number.MAX_VALUE }), params(userId))).status).toBe(400);
    expect(await Usage.countDocuments()).toBe(0);
  });

  it("admin routes reject missing users and changes to a live provider plan", async () => {
    vi.mocked(getAdminSession).mockResolvedValue({ id: "admin_1" } as never);
    expect((await adminPlan(request("/admin/plan", { plan: "pro" }), params(new mongoose.Types.ObjectId().toHexString()))).status).toBe(404);
    const sub = await subscription(await user());
    await activate(sub);
    expect((await adminUsage(request("/admin/usage", { plan: "free" }), params(sub.userId))).status).toBe(409);
    expect((await Usage.findOne({ userId: sub.userId }))?.plan).toBe("pro");
  });

  it("an old subscription callback cannot overwrite a subsequent manual assignment", async () => {
    const sub = await subscription(await user());
    await activate(sub);
    sub.status = "cancelled";
    await sub.save();
    await syncUserSubscriptionState({ userId: sub.userId, action: "admin", override: { plan: "basic" } });
    await activate(sub);
    expect((await Usage.findOne({ userId: sub.userId }))?.plan).toBe("basic");
  });

  it("organization billing GET returns defaults without inserting Usage", async () => {
    vi.stubEnv("ORGS_ENABLED", "true");
    const userId = await user();
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: userId }, session: {} } as never);
    await mongoose.connection.collection("organization").insertOne({ id: "one", name: "One" });
    await mongoose.connection.collection("member").insertOne({ organizationId: "one", userId, role: "owner" });
    const response = await orgBilling(request("/api/orgs/one/billing"), { params: Promise.resolve({ orgId: "one" }) });
    expect(response.status).toBe(200);
    expect((await response.json()).usage.plan).toBe("org-free");
    expect(await OrgUsage.countDocuments()).toBe(0);
    expect(await BillingEvent.countDocuments()).toBe(0);
  });

  it("expiry cron includes organization plans without expiring a live personal plan", async () => {
    const sub = await subscription(await user());
    await activate(sub);
    await OrgUsage.create({ orgId: "one", accountId: "org:one", plan: "org-team", seats: 20,
      planExpiresAt: new Date(Date.now() - SUBSCRIPTION_GRACE_PERIOD_MS - 1000) });
    vi.stubEnv("CRON_SECRET", "test-secret");
    const response = await expirePlans(new NextRequest("http://localhost/api/cron/expire-plans", {
      headers: { authorization: "Bearer test-secret" },
    }));
    expect((await response.json()).orgExpiredCount).toBe(1);
    expect((await OrgUsage.findOne({ orgId: "one" }))?.seats).toBe(3);
    expect((await Usage.findOne({ userId: sub.userId }))?.plan).toBe("pro");
  });

  it("personal subscription selection excludes the payer's organization subscriptions", async () => {
    const userId = await user();
    const personal = await subscription(userId);
    const org = await subscription(userId, "org:one", true);
    expect(String((await findActiveSubscription(userId))?._id)).toBe(String(personal._id));
    expect(await findActiveSubscription(userId, org.subscription_id)).toBeNull();
  });

  it("organization charge checkpoints its invoice without touching the payer's campaign", async () => {
    const userId = await user();
    const personal = await subscription(userId);
    await activate(personal);
    await Usage.updateOne({ userId }, { $set: { campaignType: "limited", campaignCyclesLeft: 2 } });
    const org = await subscription(userId, "org:one", true);
    const context = { eventId: "org_charge", eventType: "subscription.charged", source: "razorpay_subscription" as const,
      event: { payload: { subscription: { entity: { id: org.subscription_id, current_end: Math.floor(org.endDate.getTime() / 1000), quantity: 10 } },
        payment: { entity: { id: "pay_org", amount: 49900, currency: "INR" } } } } };
    expect((await dispatchWebhookEvent(context)).status).toBe("processed");
    expect((await dispatchWebhookEvent(context)).status).toBe("processed");
    expect((await Usage.findOne({ userId }))?.campaignCyclesLeft).toBe(2);
    expect((await Payment.findOne({ payment_id: "pay_org" }))?.accountId).toBe("org:one");
    expect((await SubscriptionInvoice.findOne({ payment_id: "pay_org" }))?.usageAppliedAt).toBeInstanceOf(Date);
    expect((await OrgUsage.findOne({ orgId: "one" }))?.seats).toBe(10);
  });

  it("admin cancellation routes an organization subscription without changing the payer's plan", async () => {
    const userId = await user();
    await activate(await subscription(userId));
    const org = await subscription(userId, "org:one", true);
    await syncOrgSubscriptionState({ orgId: "one", subscriptionDocId: org._id,
      status: "active", expiresAt: org.endDate, autopayActive: true });
    vi.mocked(getAdminSession).mockResolvedValue({ id: "admin_1" } as never);
    const response = await adminCancel(request("/admin/cancel", {}), { params: Promise.resolve({ id: String(org._id) }) });
    expect(response.status).toBe(200);
    expect((await OrgUsage.findOne({ orgId: "one" }))?.autopayActive).toBe(false);
    expect((await Usage.findOne({ userId }))?.autopayActive).toBe(true);
  });

  it("reconciliation routes a halted organization subscription to organization grace", async () => {
    const userId = await user();
    await activate(await subscription(userId));
    const org = await subscription(userId, "org:one", true);
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.mocked(razorpay.subscriptions.fetch).mockImplementation(async (id) => ({ status: id === org.subscription_id ? "halted" : "active" }) as never);
    const response = await reconcileSubscriptions(new NextRequest("http://localhost/api/cron/reconcile-subscriptions", {
      headers: { authorization: "Bearer test-secret" },
    }));
    expect(response.status).toBe(200);
    expect((await OrgUsage.findOne({ orgId: "one" }))?.plan).toBe("org-team");
    expect((await OrgUsage.findOne({ orgId: "one" }))?.isGracePeriod).toBe(true);
    expect((await Usage.findOne({ userId }))?.autopayActive).toBe(true);
  });
});

import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { POST as changePlan } from "@/app/api/subscriptions/change-plan/route";
import { getServerSession } from "@/lib/auth/session";
import razorpay from "@/lib/razorpay";
import Subscription from "@/models/Subscription";

vi.mock("@/lib/razorpay", () => ({ default: { subscriptions: { update: vi.fn() } } }));

describe("change-plan route", () => {
  it("explains that a UPI AutoPay subscription cannot change plan, and changes nothing", async () => {
    const userId = new mongoose.Types.ObjectId().toHexString();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: userId, email: `${userId}@example.test` }, session: { id: `s-${userId}` },
    } as unknown as NonNullable<Awaited<ReturnType<typeof getServerSession>>>);
    const sub = await Subscription.create({
      userId, accountId: userId, planSlug: "basic", status: "active", subscription_id: `sub_${userId}`,
      billingCycle: "monthly", startDate: new Date(), endDate: new Date(Date.now() + 30 * 86400_000),
      current_period_start: new Date(), current_period_end: new Date(Date.now() + 30 * 86400_000),
      autoRenew: true, metadata: { basePlanAmount: 14900, basePlanAmountINR: 149 },
    });
    // What Razorpay answers for a subscription paid by UPI AutoPay.
    vi.mocked(razorpay.subscriptions.update).mockRejectedValue({
      statusCode: 400, error: { code: "BAD_REQUEST_ERROR", description: "subscriptions cannot be updated when payment mode is upi" },
    });

    const response = await changePlan(new NextRequest("http://localhost/api/subscriptions/change-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPlanSlug: "pro", newBillingCycle: "monthly", effective: "immediate" }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "plan_change_unsupported_upi" });
    expect((await Subscription.findById(sub._id).lean())?.planSlug).toBe("basic");
  });
});

import { createHmac } from "node:crypto";
import mongoose from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as webhook } from "@/app/api/payment/razorpay/webhook/route";
import Subscription from "@/models/Subscription";
import Usage from "@/models/Usage";
import WebhookLog from "@/models/WebhookLog";
import { getPlanBySlugFromDB } from "@/lib/config/getPricingConfig";

const SECRET = "test-webhook-secret";
function post(body: object, secret = SECRET) {
  const raw = JSON.stringify(body);
  return webhook(new Request("http://localhost/api/payment/razorpay/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-razorpay-signature": createHmac("sha256", secret).update(raw).digest("hex") },
    body: raw,
  }));
}

afterEach(() => vi.unstubAllEnvs());

describe("Razorpay webhook route", () => {
  it("refuses a bad signature, applies a signed activation once and replays a duplicate", async () => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", SECRET);
    const userId = new mongoose.Types.ObjectId().toHexString();
    await mongoose.connection.collection("user").insertOne({ _id: new mongoose.Types.ObjectId(userId), name: "Hook", email: `${userId}@example.test` });
    const now = Math.floor(Date.now() / 1000);
    const event = {
      id: `evt_${userId}`, event: "subscription.activated", entity: "event", payload: { subscription: { entity: {
        id: `sub_${userId}`, status: "active", current_start: now, current_end: now + 30 * 86400,
        notes: { userId, planSlug: "pro", billingCycle: "monthly", basePlanAmount: "39900" },
      } } },
    };

    expect((await post(event, "not-the-secret")).status).toBe(401);
    expect(await WebhookLog.countDocuments({ eventId: event.id })).toBe(0);

    const applied = await post(event);
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({ success: true, handled: "processed" });
    const pro = await getPlanBySlugFromDB("pro");
    expect((await Usage.findOne({ userId }))?.storageLimitBytes).toBe(pro!.storageLimitBytes);
    expect((await Subscription.findOne({ subscription_id: `sub_${userId}` }))?.status).toBe("active");

    expect(await (await post(event)).json()).toMatchObject({ success: true, replay: true });
    expect(await WebhookLog.countDocuments({ eventId: event.id })).toBe(1);
  });
});

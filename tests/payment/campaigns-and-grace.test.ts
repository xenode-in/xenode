/**
 * campaigns-and-grace.test.ts
 *
 * Tests the new billing rules:
 * 1. Campaign Resolution (Target Audience restrictions)
 * 2. Limited Campaign Cycles logic
 * 3. 7-Day Grace Period logic
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveActiveCampaign } from "@/lib/pricing/pricingService";
import { makeUserId, createUsage } from "../helpers/factories";
import mongoose from "mongoose";
import Usage from "@/models/Usage";

describe("Campaign and Grace Period Billing Logic", () => {
  const userId = makeUserId();

  beforeEach(async () => {
    // Standard mock setup for Next.js APIs if we need them
    const { getServerSession } = await import("@/lib/auth/session");
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: userId, name: "Test", email: "t@xenode.app" },
    } as any);
    process.env.PAYU_MERCHANT_KEY = "test_key";
    process.env.CRON_SECRET = "test-cron-secret";
  });

  describe("1. Target Audience Campaign Resolution", () => {
    const activeCampaign = {
      name: "Sale",
      discountPercent: 50,
      badge: "Sale",
      startDate: new Date(Date.now() - 10000),
      endDate: new Date(Date.now() + 100000),
      isActive: true,
      discountDuration: "forever" as const,
      discountCycles: null,
      targetAudience: "free_only" as const,
    };

    it("applies the free_only campaign to a user on the free plan", () => {
      const result = resolveActiveCampaign(activeCampaign, "free", new Date());
      expect(result).not.toBeNull();
      expect(result?.discountPercent).toBe(50);
    });

    it("hides the free_only campaign from a user on a paid plan", () => {
      const result = resolveActiveCampaign(activeCampaign, "pro", new Date());
      expect(result).toBeNull();
    });

    it("applies an 'all' audience campaign to paid users", () => {
      const allCampaign = { ...activeCampaign, targetAudience: "all" as const };
      const result = resolveActiveCampaign(allCampaign, "pro", new Date());
      expect(result).not.toBeNull();
    });
  });

  describe("2. Limited Cycles & Grace Period in charge-recurring", () => {
    it("handles the Grace Period logic when a recurring payment fails", async () => {
      global.fetch = vi.fn(async (url, options: any) => {
        const params = new URLSearchParams(options.body);
        const var1 = JSON.parse(params.get("var1") || "{}");
        const reqTxnid = var1.txnid;
        
        return {
          json: async () => ({
            details: {
              [reqTxnid]: { status: "failed", payuid: "payu123" }
            }
          })
        };
      }) as any;

      // Insert a real user document first so charge-recurring finds it
      const db = mongoose.connection.db;
      await db!.collection("user").insertOne({
        _id: new mongoose.Types.ObjectId(userId),
        name: "Test User",
        email: "test@x.app",
        phone: "1234567890"
      });

      // Insert a user whose plan expires in 1 ms
      const usage = await Usage.create({
        userId,
        plan: "pro",
        totalStorageBytes: 0,
        storageLimitBytes: 1000,
        planPriceINR: 500,
        planExpiresAt: new Date(Date.now() + 1), // Due now
        planActivatedAt: new Date(),
        autopayActive: true,
        autopayMandateId: "mandate123",
        isGracePeriod: false,
      });

      // Mock randomBytes so we know the txnId or mock crypto directly?
      // Not strictly necessary since the route loops over users
      const req = new Request("http://localhost/api/payment/payu/charge-recurring", {
        method: "POST",
        headers: { "authorization": "Bearer test-cron-secret" }
      });

      const { POST } = await import("@/app/api/payment/payu/charge-recurring/route");
      // Wait for 1ms so plan expires
      await new Promise(r => setTimeout(r, 2));

      const res = await POST(req as any);
      expect(res.status).toBe(200);

      // Verify Grace Period was applied
      const updatedUsage = await Usage.findOne({ userId });
      expect(updatedUsage).toBeDefined();
      expect(updatedUsage!.autopayActive).toBe(false);
      expect(updatedUsage!.isGracePeriod).toBe(true);
      expect(updatedUsage!.gracePeriodEndsAt).toBeInstanceOf(Date);
      
      // Ensure plan was extended by ~7 days
      const daysExtended = (updatedUsage!.planExpiresAt!.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(Math.round(daysExtended)).toBe(7);
    });

    it("removes a limited campaign and reverts to base price when cycles hit 0", async () => {
       global.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          details: {
            // "unknown_txnid" -> status: "captured"
            // Wait, charge-recurring generates the txnid dynamically.
            // But we can mock the fetch to ALWAYS return status: "captured" 
            // no matter what txnid was requested.
          }
        })
      });
      
      // Override fetch mock specifically for this test
      const oldFetch = global.fetch;
      global.fetch = vi.fn(async (url, options: any) => {
        // Parse the body to find the txnid requested
        const params = new URLSearchParams(options.body);
        const var1 = JSON.parse(params.get("var1") || "{}");
        const reqTxnid = var1.txnid;
        
        return {
          json: async () => ({
            details: {
              [reqTxnid]: { status: "captured", payuid: "payu123" }
            }
          })
        };
      }) as any;

      // Seed user with 1 cycle left on a 50% limited campaign
      const user2Id = makeUserId();
      const db = mongoose.connection.db;
      await db!.collection("user").insertOne({
        _id: new mongoose.Types.ObjectId(user2Id),
        name: "Test User 2",
        email: "test2@x.app",
        phone: "1234567890"
      });
      await Usage.create({
        userId: user2Id,
        plan: "pro",
        totalStorageBytes: 0,
        storageLimitBytes: 1000,
        planPriceINR: 500, // discounted price
        basePlanPriceINR: 1000, // full price
        campaignType: "limited",
        campaignCyclesLeft: 1, // Will drop to 0
        planExpiresAt: new Date(Date.now() - 1000), // Overdue
        planActivatedAt: new Date(),
        autopayActive: true,
        autopayMandateId: "mandate123",
      });

      const { POST } = await import("@/app/api/payment/payu/charge-recurring/route");
      const req = new Request("http://localhost/api/payment/payu/charge-recurring", {
        method: "POST",
        headers: { "authorization": "Bearer test-cron-secret" }
      });

      const res = await POST(req as any);
      expect(res.status).toBe(200);

      // Validate database
      const updatedUsage = await Usage.findOne({ userId: user2Id });
      
      // It should have charged the discounted 500 one last time, 
      // but updated the usage to 1000 for the NEXT cycle.
      expect(updatedUsage!.campaignCyclesLeft).toBe(0);
      expect(updatedUsage!.planPriceINR).toBe(500); // Wait, charge-recurring sets planPriceINR to what they were just charged?
      // Ah, looking at the code: chargeAmount = usage.planPriceINR, newPlanPriceINR = usage.planPriceINR.
      // If cyclesLeft > 0, it decreases it by 1 and charges the current planPriceINR.
      // Next month, it will see cyclesLeft == 0, and then revert the price to basePlanPrice.
      
      // Let's check exactly what the code did. Since it was 1, it should now be 0, and planPriceINR remains 500.
      expect(updatedUsage!.campaignCyclesLeft).toBe(0);
      expect(updatedUsage!.planPriceINR).toBe(500);
      
      // RUN IT AGAIN to simulate the next month
      await Usage.updateOne({ userId: user2Id }, { planExpiresAt: new Date(Date.now() - 1000) });
      await POST(req as any);
      
      const updatedUsageMonth2 = await Usage.findOne({ userId: user2Id });
      // Now it should have reverted to 1000!
      expect(updatedUsageMonth2!.campaignCyclesLeft).toBeNull();
      expect(updatedUsageMonth2!.campaignType).toBeNull();
      expect(updatedUsageMonth2!.planPriceINR).toBe(1000); // Reverted!

      global.fetch = oldFetch;
    });
  });
});
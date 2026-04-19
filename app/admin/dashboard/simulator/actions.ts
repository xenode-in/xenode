"use server";

import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import Payment from "@/models/Payment";
import crypto from "crypto";
import { revalidatePath } from "next/cache";

export async function getUserUsage(userId: string) {
  await dbConnect();
  const usage = await Usage.findOne({ userId }).lean();
  return JSON.parse(JSON.stringify(usage));
}

// Manually trigger the recurring charge logic exactly like the cron job
// but we pass in whether it "succeeded" or "failed" to skip real PayU calls
export async function mockChargeRecurring(
  userId: string,
  forceStatus: "success" | "failed",
) {
  await dbConnect();
  const usage = await Usage.findOne({ userId });
  if (!usage) throw new Error("Usage not found");

  if (!usage.autopayActive) {
    return { error: "User does not have autopayActive set to true" };
  }

  // Handle limited campaigns: Revert to base price if cycles run out
  let chargeAmount = usage.planPriceINR;
  let newCampaignCyclesLeft = usage.campaignCyclesLeft;
  let newPlanPriceINR = usage.planPriceINR;
  let newCampaignType = usage.campaignType;

  if (usage.campaignType === "limited") {
    if (usage.campaignCyclesLeft != null && usage.campaignCyclesLeft > 0) {
      chargeAmount = usage.planPriceINR;
      newCampaignCyclesLeft = usage.campaignCyclesLeft - 1;
    } else {
      chargeAmount = usage.basePlanPriceINR || usage.planPriceINR;
      newPlanPriceINR = usage.basePlanPriceINR || usage.planPriceINR;
      newCampaignType = null;
      newCampaignCyclesLeft = null;
    }
  }

  const txnid = "SIM" + Date.now() + crypto.randomBytes(6).toString("hex");
  const amount = chargeAmount.toFixed(2);

  // MOCK Payment record
  await Payment.create({
    userId: usage.userId,
    amount: parseFloat(amount),
    currency: "INR",
    status: forceStatus,
    txnid,
    planName: "SIMULATED_CHARGE",
  });

  const lastPayment = await Payment.findOne({
    userId: usage.userId,
    status: "success",
  })
    .sort({ createdAt: -1 })
    .select("billingCycle");
  const cycle = lastPayment?.billingCycle || "monthly";

  let nextExpiryDate = new Date();
  if (cycle === "yearly")
    nextExpiryDate.setFullYear(nextExpiryDate.getFullYear() + 1);
  else if (cycle === "quarterly")
    nextExpiryDate.setMonth(nextExpiryDate.getMonth() + 3);
  else nextExpiryDate.setMonth(nextExpiryDate.getMonth() + 1);

  if (forceStatus === "success") {
    await Usage.updateOne(
      { userId: usage.userId },
      {
        $set: {
          planActivatedAt: new Date(),
          planExpiresAt: nextExpiryDate,
          lastRenewalTxnid: txnid,
          planPriceINR: newPlanPriceINR,
          campaignType: newCampaignType,
          campaignCyclesLeft: newCampaignCyclesLeft,
          isGracePeriod: false,
          gracePeriodEndsAt: null,
        },
      },
    );
  } else if (forceStatus === "failed") {
    if (!usage.isGracePeriod) {
      const graceEnds = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await Usage.updateOne(
        { userId: usage.userId },
        {
          $set: {
            autopayActive: false,
            lastRenewalTxnid: txnid,
            isGracePeriod: true,
            gracePeriodEndsAt: graceEnds,
            planExpiresAt: graceEnds,
          },
        },
      );
    } else {
      await Usage.updateOne(
        { userId: usage.userId },
        { $set: { autopayActive: false, lastRenewalTxnid: txnid } },
      );
    }
  }

  revalidatePath("/admin/dashboard/simulator");
  return { success: true, newStatus: forceStatus, chargeAmount };
}

// Time travel: set expiresAt to "now" so it acts like it's due
export async function timeTravelUsage(userId: string) {
  await dbConnect();
  await Usage.updateOne(
    { userId },
    { $set: { planExpiresAt: new Date(Date.now() - 1000) } },
  );
  revalidatePath("/admin/dashboard/simulator");
  return { success: true };
}

// Initialize a clean state for testing
export async function initializeTestState(
  userId: string,
  state: "pro_forever" | "pro_limited",
) {
  await dbConnect();

  const updateData: any = {
    plan: "pro",
    autopayActive: true,
    autopayMandateId: "MOCK_MANDATE_123",
    planPriceINR: 500,
    basePlanPriceINR: 1000,
    planActivatedAt: new Date(),
    planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    isGracePeriod: false,
    gracePeriodEndsAt: null,
  };

  if (state === "pro_forever") {
    updateData.campaignType = "forever";
    updateData.campaignCyclesLeft = null;
  } else if (state === "pro_limited") {
    updateData.campaignType = "limited";
    updateData.campaignCyclesLeft = 2; // 2 more discounted cycles
  }

  await Usage.findOneAndUpdate(
    { userId },
    { $set: updateData },
    { upsert: true },
  );

  // Add a fake payment so cycle detection works
  await Payment.create({
    userId,
    amount: 500,
    currency: "INR",
    status: "success",
    txnid: "SETUP" + Date.now(),
    planName: "Pro",
    billingCycle: "monthly",
  });

  revalidatePath("/admin/dashboard/simulator");
  return { success: true };
}

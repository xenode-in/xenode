import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";
import Subscription from "@/models/Subscription";

/**
 * Cron endpoint — runs daily at midnight UTC.
 * Secured with CRON_SECRET header to prevent unauthorized triggering.
 *
 * Register in vercel.json:
 * { "crons": [{ "path": "/api/cron/expire-plans", "schedule": "0 0 * * *" }] }
 */
export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await dbConnect();
    const now = new Date();
    let expiredCount = 0;

    const gracePeriodDays = 7;
    const graceMs = gracePeriodDays * 24 * 60 * 60 * 1000;

    // --- Step 1a: Grant Grace Period to recently expired non-autopay users ---
    // If a user's plan just expired naturally (autopay was off or manual payment)
    // and they aren't already in a grace period, grant them 7 days.
    const graceResult = await Usage.updateMany(
      {
        plan: { $ne: "free" },
        planExpiresAt: { $lt: now },
        isGracePeriod: false,
      },
      [
        {
          $set: {
            isGracePeriod: true,
            gracePeriodEndsAt: { $add: [now, graceMs] },
            planExpiresAt: { $add: [now, graceMs] },
          }
        }
      ]
    );

    // --- Step 1b: Expire lapsed plans (Grace period ended) ---
    // If they were already in a grace period and that period has now expired,
    // downgrade them to the free tier completely.
    const expireResult = await Usage.updateMany(
      {
        plan: { $ne: "free" },
        isGracePeriod: true,
        gracePeriodEndsAt: { $lt: now },
      },
      {
        $set: {
          plan: "free",
          storageLimitBytes: FREE_TIER_LIMIT_BYTES,
          planPriceINR: 0,
          basePlanPriceINR: 0,
          campaignType: null,
          campaignCyclesLeft: null,
          isGracePeriod: false,
          gracePeriodEndsAt: null,
          autopayActive: false,
        },
      },
    );
    expiredCount = expireResult.modifiedCount;

    // --- Step 2: Update Subscriptions ---
    await Subscription.updateMany(
      {
        status: "active",
        endDate: { $lt: now },
      },
      {
        $set: {
          status: "expired"
        }
      }
    );

    return NextResponse.json({
      success: true,
      grantedGraceCount: graceResult.modifiedCount,
      expiredCount,
      processedAt: now.toISOString(),
    });
  } catch (error) {
    console.error("[Cron] expire-plans error:", error);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}

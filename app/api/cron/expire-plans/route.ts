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

    // --- Step 1: Expire unpaid/lapsed plans ---
    const expireResult = await Usage.updateMany(
      {
        plan: { $ne: "free" },
        planExpiresAt: { $lt: now },
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
      expiredCount,
      processedAt: now.toISOString(),
    });
  } catch (error) {
    console.error("[Cron] expire-plans error:", error);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}

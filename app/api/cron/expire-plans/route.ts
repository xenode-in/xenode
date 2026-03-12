import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";

const FREE_TIER_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

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
    let downgradedCount = 0;
    let downgradeBlockedCount = 0;

    // --- Step 1: Expire unpaid/lapsed plans ---
    const expireResult = await Usage.updateMany(
      {
        plan: { $ne: "free" },
        planExpiresAt: { $lt: now },
        scheduledDowngradePlan: null, // don't double-process scheduled downgrades
      },
      {
        $set: {
          plan: "free",
          storageLimitBytes: FREE_TIER_BYTES,
          planPriceINR: 0,
        },
      },
    );
    expiredCount = expireResult.modifiedCount;

    // --- Step 2: Process scheduled downgrades that are due ---
    const toDowngrade = await Usage.find({
      scheduledDowngradePlan: { $ne: null },
      scheduledDowngradeAt: { $lte: now },
    });

    for (const record of toDowngrade) {
      if (
        record.scheduledDowngradeLimitBytes !== null &&
        record.totalStorageBytes <= record.scheduledDowngradeLimitBytes
      ) {
        // Safe to downgrade
        await Usage.updateOne(
          { _id: record._id },
          {
            $set: {
              plan: record.scheduledDowngradePlan === "free" ? "free" : "pro",
              storageLimitBytes: record.scheduledDowngradeLimitBytes,
              planPriceINR: 0,
              scheduledDowngradePlan: null,
              scheduledDowngradeLimitBytes: null,
              scheduledDowngradeAt: null,
            },
          },
        );
        downgradedCount++;
      } else {
        // User exceeded quota since scheduling — block downgrade, log for notification
        // TODO: integrate email/notification service to alert the user
        console.warn(
          `[Cron] Downgrade blocked for userId=${record.userId}: ` +
          `usage=${record.totalStorageBytes} > limit=${record.scheduledDowngradeLimitBytes}`,
        );
        downgradeBlockedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      expiredCount,
      downgradedCount,
      downgradeBlockedCount,
      processedAt: now.toISOString(),
    });
  } catch (error) {
    console.error("[Cron] expire-plans error:", error);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}

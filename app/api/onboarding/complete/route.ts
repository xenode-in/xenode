import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";

export const dynamic = "force-dynamic";

/**
 * POST /api/onboarding/complete
 *
 * Called at the very end of the onboarding wizard.
 * Creates (or safely upserts) the Usage document for the user.
 *
 * ALWAYS sets plan = "free" with storageLimitBytes = FREE_TIER_LIMIT_BYTES (5 GB).
 *
 * Reasoning:
 *  - Xenode does NOT have a "pro" plan selectable at sign-up.
 *  - Real paid plans (100GB, 500GB, 1TB, 2TB) are purchased via
 *    /checkout?plan=... after the user is in the dashboard.
 *  - The PayU success webhook (app/api/payment/payu/success/route.ts)
 *    is the ONLY place that sets plan to a paid tier and updates
 *    storageLimitBytes from the server-authoritative PendingTransaction.
 *
 * This separation means:
 *  - Onboarding is always clean and fast (no payment during signup)
 *  - Usage document is always in a valid state after onboarding
 *  - No broken "pro" ghost state in the database
 */
export async function POST(_request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    await dbConnect();

    // Upsert — safe to call even if a Usage doc was somehow pre-created.
    // $setOnInsert never overwrites counters if the doc already exists.
    // $set always ensures plan and limit are correct for a fresh signup.
    await Usage.findOneAndUpdate(
      { userId },
      {
        $setOnInsert: {
          totalStorageBytes: 0,
          totalEgressBytes: 0,
          totalObjects: 0,
          totalBuckets: 0,
          uploadCount: 0,
          downloadCount: 0,
        },
        $set: {
          plan: "free",
          storageLimitBytes: FREE_TIER_LIMIT_BYTES,
          planActivatedAt: new Date(),
          planExpiresAt: null,
          planPriceINR: 0,
          lastActiveAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );

    return NextResponse.json({
      success: true,
      plan: "free",
      storageLimitBytes: FREE_TIER_LIMIT_BYTES,
    });
  } catch (error) {
    console.error("[onboarding/complete] error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to complete onboarding";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

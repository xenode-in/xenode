import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Usage, { FREE_TIER_LIMIT_BYTES, PRO_TIER_LIMIT_BYTES } from "@/models/Usage";

export const dynamic = "force-dynamic";

/**
 * POST /api/onboarding/complete
 *
 * Called at the end of the onboarding flow after the user picks a plan.
 * Creates or updates the Usage document for the user with the correct
 * plan and storageLimitBytes.
 *
 * Body:
 *   plan           "free" | "pro"
 *
 * Behaviour:
 *   free  → storageLimitBytes = FREE_TIER_LIMIT_BYTES (5 GB), plan = "free"
 *   pro   → storageLimitBytes = PRO_TIER_LIMIT_BYTES, plan = "pro"
 *           (actual billing is handled separately by the payment webhook)
 *
 * This is the ONLY place where a fresh Usage document should be created
 * during normal sign-up. All other routes (presign-upload, complete-upload)
 * rely on this document already existing.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const body = await request.json();
    const plan: "free" | "pro" = body.plan === "pro" ? "pro" : "free";

    // Map plan to storage limit
    const storageLimitBytes =
      plan === "pro" ? PRO_TIER_LIMIT_BYTES : FREE_TIER_LIMIT_BYTES;

    await dbConnect();

    // Upsert — safe to call even if Usage doc was somehow created already
    await Usage.findOneAndUpdate(
      { userId },
      {
        $setOnInsert: {
          // Only set these on first creation — never overwrite existing usage counters
          totalStorageBytes: 0,
          totalEgressBytes: 0,
          totalObjects: 0,
          totalBuckets: 0,
          uploadCount: 0,
          downloadCount: 0,
        },
        $set: {
          plan,
          storageLimitBytes,
          planActivatedAt: new Date(),
          // Free tier has no expiry
          planExpiresAt: null,
          lastActiveAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );

    return NextResponse.json({ success: true, plan, storageLimitBytes });
  } catch (error) {
    console.error("[onboarding/complete] error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to complete onboarding";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

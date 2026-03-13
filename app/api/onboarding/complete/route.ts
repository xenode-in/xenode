import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";

export const dynamic = "force-dynamic";

/**
 * POST /api/onboarding/complete
 *
 * Called at the end of the onboarding flow after the user picks a plan.
 * Creates or updates the Usage document for the user with the correct
 * plan and storageLimitBytes.
 *
 * Body:
 *   plan  "free" | "pro"
 *
 * Behaviour:
 *   free → storageLimitBytes = FREE_TIER_LIMIT_BYTES (5 GB), plan = "free"
 *   pro  → storageLimitBytes = null (unlimited), plan = "pro"
 *          (actual billing handled by payment webhook — we do NOT redirect
 *           to /pricing here; the client handles navigation)
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
    // Default to "free" — pro requires explicit opt-in
    const plan: "free" | "pro" = body.plan === "pro" ? "pro" : "free";

    // Free = 5 GB hard limit. Pro = null (unlimited, enforced via billing).
    const storageLimitBytes = plan === "pro" ? null : FREE_TIER_LIMIT_BYTES;

    await dbConnect();

    // Upsert — safe to call even if Usage doc was somehow created already.
    // $setOnInsert never overwrites existing usage counters on subsequent calls.
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
          plan,
          storageLimitBytes,
          planActivatedAt: new Date(),
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

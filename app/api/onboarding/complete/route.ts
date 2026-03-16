import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const userId = session.user.id;

    await dbConnect();

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

    return NextResponse.json({ success: true, plan: "free", storageLimitBytes: FREE_TIER_LIMIT_BYTES });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to complete onboarding";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

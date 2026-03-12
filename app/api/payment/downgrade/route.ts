import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";

/**
 * Server-authoritative plan definitions for downgrades.
 * Never accept storageLimitBytes from the client.
 */
const DOWNGRADE_PLANS: Record<string, { storageLimitBytes: number; label: string }> = {
  free:    { storageLimitBytes: 10  * 1024 * 1024 * 1024, label: "Free (10 GB)" },
  pro100:  { storageLimitBytes: 100 * 1024 * 1024 * 1024, label: "100 GB" },
  pro500:  { storageLimitBytes: 500 * 1024 * 1024 * 1024, label: "500 GB" },
};

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { targetPlan } = await req.json();

    // Validate against server-authoritative allowlist
    const target = DOWNGRADE_PLANS[targetPlan];
    if (!target) {
      return NextResponse.json({ error: "Invalid target plan" }, { status: 400 });
    }

    await dbConnect();
    const usage = await Usage.findOne({ userId: session.user.id });
    if (!usage) {
      return NextResponse.json({ error: "Usage record not found" }, { status: 404 });
    }

    // Prevent downgrade to a higher or equal plan
    if (target.storageLimitBytes >= usage.storageLimitBytes) {
      return NextResponse.json(
        { error: "Target plan is not a downgrade from current plan" },
        { status: 400 },
      );
    }

    // Check if current usage exceeds the new plan limit
    if (usage.totalStorageBytes > target.storageLimitBytes) {
      return NextResponse.json(
        {
          error: "over_quota",
          message: `You are using ${usage.totalStorageBytes} bytes but the ${target.label} plan allows only ${target.storageLimitBytes} bytes. Please delete files before downgrading.`,
          currentUsageBytes: usage.totalStorageBytes,
          newLimitBytes: target.storageLimitBytes,
          excessBytes: usage.totalStorageBytes - target.storageLimitBytes,
        },
        { status: 409 },
      );
    }

    // Schedule downgrade to take effect at end of current billing cycle
    await Usage.findOneAndUpdate(
      { userId: session.user.id },
      {
        $set: {
          scheduledDowngradePlan: targetPlan,
          scheduledDowngradeLimitBytes: target.storageLimitBytes,
          scheduledDowngradeAt: usage.planExpiresAt || new Date(),
        },
      },
    );

    return NextResponse.json({
      success: true,
      message: `Downgrade to ${target.label} scheduled for ${usage.planExpiresAt?.toISOString() ?? "immediately"}.`,
      effectiveAt: usage.planExpiresAt,
    });
  } catch (error) {
    console.error("Downgrade error:", error);
    return NextResponse.json({ error: "Failed to schedule downgrade" }, { status: 500 });
  }
}

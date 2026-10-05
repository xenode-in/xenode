import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import OrgUsage from "@/models/OrgUsage";
import { syncUserSubscriptionState } from "@/lib/subscriptions/service";
import { syncOrgSubscriptionState } from "@/lib/orgs/billing/service";

/** Authenticated HTTP cron. Each bounded candidate is rechecked transactionally. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await dbConnect();
    const now = new Date();
    const due = {
      planExpiresAt: { $lte: now },
      $or: [{ isGracePeriod: false }, { isGracePeriod: true, gracePeriodEndsAt: { $lte: now } }],
    };
    let grantedGraceCount = 0;
    let expiredCount = 0;
    let orgGrantedGraceCount = 0;
    let orgExpiredCount = 0;
    const personal = await Usage.find({ ...due, plan: { $ne: "free" } })
      .select("userId").sort({ planExpiresAt: 1, _id: 1 }).limit(200).lean();
    for (const row of personal) {
      const { outcome } = await syncUserSubscriptionState({
        userId: row.userId, action: "expire", now, actor: { actorType: "system", actorId: "cron" },
      });
      if (outcome === "grace") grantedGraceCount++;
      if (outcome === "expired") expiredCount++;
    }
    const organizations = await OrgUsage.find({ ...due, plan: { $ne: "org-free" } })
      .select("orgId").sort({ planExpiresAt: 1, _id: 1 }).limit(200).lean();
    for (const row of organizations) {
      const { outcome } = await syncOrgSubscriptionState({
        orgId: row.orgId, action: "expire", now, actor: { actorType: "system", actorId: "cron" },
      });
      if (outcome === "grace") orgGrantedGraceCount++;
      if (outcome === "expired") orgExpiredCount++;
    }
    return NextResponse.json({ success: true, grantedGraceCount, expiredCount,
      orgGrantedGraceCount, orgExpiredCount, processedAt: now.toISOString() });
  } catch (error) {
    console.error("[Cron] expire-plans error:", error);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}

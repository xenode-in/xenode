import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";

type RouteContext = { params: Promise<{ userId: string }> };

/** POST /api/admin/users/[userId]/plan — assign or revoke a plan */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const session = await getAdminSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await params;
  const { plan, expiresAt } = await req.json();

  if (!["free", "pro", "enterprise"].includes(plan))
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });

  await dbConnect();

  const updated = await Usage.findOneAndUpdate(
    { userId },
    {
      $set: {
        plan,
        planActivatedAt: plan !== "free" ? new Date() : null,
        planExpiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    },
    { upsert: true, new: true }
  );

  return NextResponse.json({
    plan: updated.plan,
    planActivatedAt: updated.planActivatedAt,
    planExpiresAt: updated.planExpiresAt,
  });
}

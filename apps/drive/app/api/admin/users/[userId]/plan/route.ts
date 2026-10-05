import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import { updateAdminPlan } from "@/lib/billing/admin-plans";
import { jsonError } from "@/lib/billing/http";

type RouteContext = { params: Promise<{ userId: string }> };

/** POST /api/admin/users/[userId]/plan — assign or revoke a manual plan. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { userId } = await params;
    return await updateAdminPlan(req, userId, admin.id, "plan");
  } catch (error) {
    return jsonError(error);
  }
}

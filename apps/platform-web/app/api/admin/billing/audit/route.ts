import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import BillingEvent from "@/models/BillingEvent";

/**
 * GET /api/admin/billing/audit
 *
 * Filters:
 *   ?type=<dot.namespaced>     exact match
 *   ?actorType=user|admin|system|webhook
 *   ?userId=<id>
 *   ?since=<ISO date>          default 30 days ago
 *   ?limit=<n>                 max 500, default 200
 */
export async function GET(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const type = sp.get("type");
  const actorType = sp.get("actorType");
  const userId = sp.get("userId");
  const sinceParam = sp.get("since");
  const limit = Math.min(500, Number(sp.get("limit") || 200));

  const since = sinceParam
    ? new Date(sinceParam)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const query: Record<string, unknown> = { createdAt: { $gte: since } };
  if (type) query.type = type;
  if (actorType) query.actorType = actorType;
  if (userId) query.userId = userId;

  await dbConnect();
  const rows = await BillingEvent.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return NextResponse.json({
    total: rows.length,
    rows: rows.map((r) => ({
      id: r._id.toString(),
      type: r.type,
      userId: r.userId,
      actorType: r.actorType,
      actorId: r.actorId,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      payload: r.payload,
      createdAt: r.createdAt,
    })),
  });
}

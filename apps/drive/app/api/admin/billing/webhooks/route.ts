import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import WebhookLog from "@/models/WebhookLog";

/**
 * GET /api/admin/billing/webhooks
 *
 * Filters: ?status=, ?eventType=, ?gateway=, ?limit= (max 200).
 * Returns most recent first.
 */
export async function GET(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const status = sp.get("status");
  const eventType = sp.get("eventType");
  const gateway = sp.get("gateway");
  const limit = Math.min(200, Number(sp.get("limit") || 100));

  const query: Record<string, unknown> = {};
  if (status) query.status = status;
  if (eventType) query.eventType = eventType;
  if (gateway) query.gateway = gateway;

  await dbConnect();
  const rows = await WebhookLog.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return NextResponse.json({
    total: rows.length,
    rows: rows.map((r) => ({
      id: r._id.toString(),
      eventId: r.eventId,
      eventType: r.eventType,
      gateway: r.gateway,
      status: r.status,
      errorMessage: r.errorMessage ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  });
}

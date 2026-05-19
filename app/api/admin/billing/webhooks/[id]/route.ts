import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import WebhookLog from "@/models/WebhookLog";

/**
 * GET /api/admin/billing/webhooks/[id] — full payload for inspection.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  await dbConnect();
  const row = await WebhookLog.findById(id).lean();
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: row._id.toString(),
    eventId: row.eventId,
    eventType: row.eventType,
    gateway: row.gateway,
    status: row.status,
    errorMessage: row.errorMessage ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    payload: row.payload,
  });
}

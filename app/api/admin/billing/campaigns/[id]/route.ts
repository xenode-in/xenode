import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Campaign from "@/models/Campaign";
import { emitBillingEvent } from "@/lib/billing/events";

/**
 * PATCH /api/admin/billing/campaigns/[id]
 *   Partial update. Only `isActive`, `endsAt`, `priority`, `maxRedemptions`
 *   are mutable — other fields (slug, dates, discount) are immutable to keep
 *   audit history meaningful. Want a different campaign? Create a new one.
 *
 * DELETE /api/admin/billing/campaigns/[id]
 *   Soft delete via isActive=false. Hard delete is intentionally not exposed
 *   so historical redemption attribution stays intact.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));

  const update: Record<string, unknown> = {};
  if (typeof body.isActive === "boolean") update.isActive = body.isActive;
  if (typeof body.priority === "number") update.priority = body.priority;
  if (body.endsAt) update.endsAt = new Date(body.endsAt);
  if (
    body.maxRedemptions === null ||
    typeof body.maxRedemptions === "number"
  ) {
    update.maxRedemptions = body.maxRedemptions;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No updatable fields" }, { status: 400 });
  }

  await dbConnect();
  const before = await Campaign.findById(id).lean();
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await Campaign.updateOne({ _id: id }, { $set: update });

  await emitBillingEvent({
    type: "admin.campaign.updated",
    actorType: "admin",
    actorId: session.id,
    subjectType: "campaign",
    subjectId: id,
    payload: { changes: update },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  await dbConnect();
  const before = await Campaign.findById(id).lean();
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await Campaign.updateOne({ _id: id }, { $set: { isActive: false } });

  await emitBillingEvent({
    type: "admin.campaign.deactivated",
    actorType: "admin",
    actorId: session.id,
    subjectType: "campaign",
    subjectId: id,
    payload: { slug: before.slug },
  });

  return NextResponse.json({ success: true });
}

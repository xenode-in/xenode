import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Campaign from "@/models/Campaign";
import { adminCampaignSchema } from "@/lib/billing/validation/schemas";
import { parseJson, jsonError, BillingError } from "@/lib/billing/http";
import { BillingEventType, emitBillingEvent } from "@/lib/billing/events";

/**
 * GET  /api/admin/billing/campaigns       — list all
 * POST /api/admin/billing/campaigns       — create
 */
export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await dbConnect();
  const rows = await Campaign.find().sort({ priority: 1, createdAt: -1 }).lean();
  return NextResponse.json({
    rows: rows.map((c) => ({
      id: c._id.toString(),
      name: c.name,
      slug: c.slug,
      discountPercent: c.discountPercent,
      flatDiscountPaise: c.flatDiscountPaise,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      isActive: c.isActive,
      badge: c.badge,
      duration: c.duration,
      cycles: c.cycles,
      targetAudience: c.targetAudience,
      applicablePlans: c.applicablePlans,
      applicableCycles: c.applicableCycles,
      razorpayOfferId: c.razorpayOfferId,
      priority: c.priority,
      maxRedemptions: c.maxRedemptions,
      redeemedCount: c.redeemedCount,
      createdAt: c.createdAt,
    })),
  });
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const input = await parseJson(request, adminCampaignSchema);

    // XOR enforcement: exactly one of percent / flat must be set.
    if (
      (input.discountPercent != null) === (input.flatDiscountPaise != null)
    ) {
      throw new BillingError(
        400,
        "Specify exactly one of discountPercent or flatDiscountPaise",
        "invalid_discount",
      );
    }
    if (input.startsAt >= input.endsAt) {
      throw new BillingError(400, "startsAt must precede endsAt", "invalid_dates");
    }

    await dbConnect();
    const exists = await Campaign.findOne({ slug: input.slug }).lean();
    if (exists) {
      throw new BillingError(
        409,
        `Campaign with slug "${input.slug}" already exists`,
        "slug_taken",
      );
    }

    const campaign = await Campaign.create({
      ...input,
      discountPercent: input.discountPercent ?? null,
      flatDiscountPaise: input.flatDiscountPaise ?? null,
      cycles: input.cycles ?? null,
      razorpayOfferId: input.razorpayOfferId ?? null,
      maxRedemptions: input.maxRedemptions ?? null,
      redeemedCount: 0,
      createdBy: session.id,
    });

    await emitBillingEvent({
      type: BillingEventType.ADMIN_CAMPAIGN_CREATED,
      actorType: "admin",
      actorId: session.id,
      subjectType: "campaign",
      subjectId: campaign._id.toString(),
      payload: {
        slug: campaign.slug,
        discountPercent: campaign.discountPercent,
        flatDiscountPaise: campaign.flatDiscountPaise,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
      },
    });

    return NextResponse.json({ id: campaign._id.toString() }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

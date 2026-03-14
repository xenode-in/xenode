import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import { PricingConfig } from "@/models/PricingConfig";
import { getPricingConfig } from "@/lib/config/getPricingConfig";

// GET — fetch current pricing config (seeds defaults if none exist)
export async function GET() {
  const session = await getAdminSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = await getPricingConfig();
  return NextResponse.json({ config });
}

// PATCH — update plans and/or campaign, then bust Next.js cache
export async function PATCH(req: NextRequest) {
  const session = await getAdminSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const update: Record<string, unknown> = { updatedBy: session.username };

  if (body.plans !== undefined) {
    if (!Array.isArray(body.plans)) {
      return NextResponse.json({ error: "plans must be an array" }, { status: 400 });
    }
    for (const plan of body.plans) {
      if (!plan.name || !plan.slug || typeof plan.priceINR !== "number") {
        return NextResponse.json(
          { error: "Each plan requires name, slug, and priceINR" },
          { status: 400 }
        );
      }
    }
    update.plans = body.plans;
  }

  if (body.campaign !== undefined) {
    update.campaign = body.campaign
      ? {
          ...body.campaign,
          startDate: new Date(body.campaign.startDate),
          endDate: new Date(body.campaign.endDate),
        }
      : null;
  }

  await dbConnect();
  const config = await PricingConfig.findOneAndUpdate(
    {},
    { $set: update },
    { new: true, upsert: true }
  ).lean();

  // Bust Next.js full-route cache so PricingComparison re-renders fresh
  revalidatePath("/pricing");
  revalidatePath("/dashboard/billing");

  return NextResponse.json({ config });
}

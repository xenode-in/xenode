/**
 * app/api/admin/pricing/route.ts
 *
 * Admin-only endpoint to read and update pricing configuration.
 *
 * REFACTORED (multi-cycle):
 *   - PATCH validation now checks for pricing[] array instead of scalar priceINR.
 *   - Each plan must have at least one entry with cycle: "monthly".
 *   - Revalidates /pricing and /dashboard/billing on update.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import { PricingConfig } from "@/models/PricingConfig";
import { getPricingConfig } from "@/lib/config/getPricingConfig";
import type { IPlanPricing } from "@/types/pricing";

// ─── GET ──────────────────────────────────────────────────────────────────────

/** Fetch current pricing config (seeds defaults if none exist) */
export async function GET() {
  const session = await getAdminSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = await getPricingConfig();
  return NextResponse.json({ config });
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

/** Update plans and/or campaign, then bust Next.js route cache */
export async function PATCH(req: NextRequest) {
  const session = await getAdminSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const update: Record<string, unknown> = { updatedBy: session.username };

  // ── Validate plans ────────────────────────────────────────────────────────
  if (body.plans !== undefined) {
    if (!Array.isArray(body.plans)) {
      return NextResponse.json({ error: "plans must be an array" }, { status: 400 });
    }

    for (const plan of body.plans) {
      // Required fields
      if (!plan.name || !plan.slug) {
        return NextResponse.json(
          { error: "Each plan requires name and slug" },
          { status: 400 }
        );
      }

      // pricing[] replaces the old scalar priceINR
      if (!Array.isArray(plan.pricing) || plan.pricing.length === 0) {
        return NextResponse.json(
          { error: `Plan "${plan.slug}" must include a pricing[] array` },
          { status: 400 }
        );
      }

      // Every plan must have at least a monthly entry
      const hasMonthly = plan.pricing.some(
        (p: IPlanPricing) => p.cycle === "monthly" && typeof p.priceINR === "number"
      );
      if (!hasMonthly) {
        return NextResponse.json(
          { error: `Plan "${plan.slug}" must include a monthly pricing entry` },
          { status: 400 }
        );
      }

      // Validate each pricing entry
      for (const entry of plan.pricing as IPlanPricing[]) {
        if (!entry.cycle || typeof entry.priceINR !== "number" || entry.priceINR < 0) {
          return NextResponse.json(
            {
              error: `Invalid pricing entry in plan "${plan.slug}": each entry needs cycle and non-negative priceINR`,
            },
            { status: 400 }
          );
        }
      }
    }

    update.plans = body.plans;
  }

  // ── Validate campaign ─────────────────────────────────────────────────────
  if (body.campaign !== undefined) {
    update.campaign = body.campaign
      ? {
          ...body.campaign,
          startDate: new Date(body.campaign.startDate),
          endDate: new Date(body.campaign.endDate),
        }
      : null;
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  await dbConnect();
  const config = await PricingConfig.findOneAndUpdate(
    {},
    { $set: update },
    { new: true, upsert: true }
  ).lean();

  // Bust Next.js full-route cache
  revalidatePath("/pricing");
  revalidatePath("/dashboard/billing");

  return NextResponse.json({ config });
}

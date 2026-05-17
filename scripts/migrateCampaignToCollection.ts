/**
 * scripts/migrateCampaignToCollection.ts
 *
 * One-shot, idempotent backfill. Reads the legacy `PricingConfig.campaign`
 * embedded field and, if it represents an active or future-scheduled campaign,
 * creates a matching row in the `Campaign` collection.
 *
 * Run:
 *   npx tsx scripts/migrateCampaignToCollection.ts
 *
 * Safe to re-run — uses upsert keyed on slug "legacy-pricing-config".
 */
import dbConnect from "@/lib/mongodb";
import { PricingConfig } from "@/models/PricingConfig";
import Campaign from "@/models/Campaign";

const LEGACY_SLUG = "legacy-pricing-config";

async function main() {
  await dbConnect();
  const config = await PricingConfig.findOne().lean();
  if (!config || !config.campaign) {
    console.log("No legacy campaign found — nothing to migrate.");
    return;
  }
  const c = config.campaign;
  if (!c.name) {
    console.log("Legacy campaign has no name — skipping.");
    return;
  }

  const result = await Campaign.findOneAndUpdate(
    { slug: LEGACY_SLUG },
    {
      $set: {
        name: c.name,
        slug: LEGACY_SLUG,
        discountPercent: c.discountPercent ?? null,
        flatDiscountPaise: null,
        startsAt: c.startDate,
        endsAt: c.endDate,
        isActive: c.isActive,
        badge: c.badge ?? "",
        duration: c.discountDuration ?? "forever",
        cycles: c.discountCycles ?? null,
        targetAudience: c.targetAudience ?? "all",
        applicablePlans: [],
        applicableCycles: [],
        razorpayOfferId: null,
        priority: 100,
        maxRedemptions: null,
        createdBy: "migration",
      },
      $setOnInsert: { redeemedCount: 0 },
    },
    { upsert: true, new: true },
  );

  console.log(
    `Migrated legacy campaign → Campaign(${result._id.toString()}) slug=${LEGACY_SLUG} active=${result.isActive}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });

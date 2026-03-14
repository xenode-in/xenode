/**
 * scripts/migratePricingToMultiCycle.ts
 *
 * One-time migration: converts old scalar `priceINR` on each plan
 * to the new `pricing: IPlanPricing[]` array shape.
 *
 * Run ONCE against your production DB before deploying the refactored code:
 *   npx ts-node -r tsconfig-paths/register scripts/migratePricingToMultiCycle.ts
 *
 * Safe to re-run: skips plans that already have a pricing[] array.
 *
 * Yearly price = monthly × 10 (≈ 2 months free, ~17% saving).
 * Adjust YEARLY_MULTIPLIER if you want a different default.
 */

import mongoose from "mongoose";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const YEARLY_MULTIPLIER = 10; // yearly = monthly × 10

async function migrate() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set in .env.local");

  await mongoose.connect(uri);
  console.log("Connected to MongoDB.");

  const db = mongoose.connection.db;
  if (!db) throw new Error("DB connection unavailable");

  const collection = db.collection("pricingconfigs");
  const docs = await collection.find({}).toArray();

  if (docs.length === 0) {
    console.log("No PricingConfig documents found. Nothing to migrate.");
    await mongoose.disconnect();
    return;
  }

  let migratedPlans = 0;
  let skippedPlans = 0;

  for (const doc of docs) {
    const updatedPlans = doc.plans.map((plan: any) => {
      // Already migrated
      if (Array.isArray(plan.pricing)) {
        skippedPlans++;
        return plan;
      }

      // Old shape — has scalar priceINR
      const monthlyPrice: number = plan.priceINR ?? 0;
      const yearlyPrice = Math.round(monthlyPrice * YEARLY_MULTIPLIER);

      migratedPlans++;
      console.log(
        `  Migrating plan "${plan.slug}": priceINR=${monthlyPrice} → monthly=${monthlyPrice}, yearly=${yearlyPrice}`
      );

      const { priceINR, ...rest } = plan; // remove old field
      return {
        ...rest,
        pricing: [
          { cycle: "monthly", priceINR: monthlyPrice },
          { cycle: "yearly", priceINR: yearlyPrice, discountPercent: 17 },
        ],
      };
    });

    await collection.updateOne(
      { _id: doc._id },
      { $set: { plans: updatedPlans } }
    );
  }

  console.log(`\nMigration complete.`);
  console.log(`  Plans migrated : ${migratedPlans}`);
  console.log(`  Plans skipped  : ${skippedPlans} (already on new shape)`);

  await mongoose.disconnect();
  console.log("Disconnected.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

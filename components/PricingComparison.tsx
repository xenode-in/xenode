/**
 * PricingComparison.tsx — Async server component.
 *
 * Fetches live pricing from DB, resolves active campaign via pricingService,
 * then hands off to PricingGrid (client) for interactivity.
 */
import { unstable_noStore as noStore } from "next/cache";
import { getPricingConfig } from "@/lib/config/getPricingConfig";
import { resolveActiveCampaign } from "@/lib/pricing/pricingService";
import PricingGrid from "@/components/PricingGrid";

export default async function PricingComparison() {
  // Opt out of Next.js full-route caching so prices are always live
  noStore();

  const { plans, campaign } = await getPricingConfig();
  const activeCampaign = resolveActiveCampaign(campaign);

  return <PricingGrid plans={plans} campaign={activeCampaign} />;
}

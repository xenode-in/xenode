/**
 * PricingComparison.tsx — Async server component.
 *
 * Fetches live pricing + the highest-priority active marketing campaign,
 * then hands off to PricingGrid (client) for interactivity.
 */
import { unstable_noStore as noStore } from "next/cache";
import { getPricingConfig } from "@/lib/config/getPricingConfig";
import { getHeadlineCampaign } from "@/lib/billing/campaigns";
import PricingGrid from "@/components/PricingGrid";

export default async function PricingComparison() {
  // Opt out of Next.js full-route caching so prices are always live
  noStore();

  const [{ plans }, headlineCampaign] = await Promise.all([
    getPricingConfig(),
    getHeadlineCampaign(),
  ]);

  const serializedPlans = JSON.parse(JSON.stringify(plans));
  const campaign = headlineCampaign
    ? {
        name: headlineCampaign.name,
        discountPercent: headlineCampaign.discountPercent ?? 0,
        badge: headlineCampaign.badge,
      }
    : null;

  return <PricingGrid plans={serializedPlans} campaign={campaign} />;
}

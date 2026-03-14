// Async server component — fetches plans from DB on every request (no-store).
// Interactive parts (buttons, session, router) live in PricingGrid (client).
import { unstable_noStore as noStore } from "next/cache";
import { getPricingConfig } from "@/lib/config/getPricingConfig";
import PricingGrid from "@/components/PricingGrid";

export default async function PricingComparison() {
  // Opt out of Next.js full-route caching so prices are always live
  noStore();

  const { plans, campaign } = await getPricingConfig();

  const now = new Date();
  const activeCampaign =
    campaign?.isActive &&
    now >= new Date(campaign.startDate) &&
    now <= new Date(campaign.endDate)
      ? campaign
      : null;

  return <PricingGrid plans={plans} campaign={activeCampaign} />;
}

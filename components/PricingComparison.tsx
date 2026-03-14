// This is now an async server component — fetches plans from DB.
// The interactive parts (buttons, session check) live in PricingGrid.
import { getPricingConfig } from "@/lib/config/getPricingConfig";
import PricingGrid from "@/components/PricingGrid";

export default async function PricingComparison() {
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

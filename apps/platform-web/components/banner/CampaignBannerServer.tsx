/**
 * CampaignBannerServer — async server component.
 * Fetches the active headline campaign and hands it to the client banner.
 * Returns null when no campaign is active, so it costs nothing visually.
 *
 * Mount inside <Suspense fallback={null}> in the root layout so the
 * campaign DB query never blocks first paint.
 */
import { getHeadlineCampaign } from "@/lib/billing/campaigns";
import CampaignBanner from "./CampaignBanner";

export default async function CampaignBannerServer() {
  const campaign = await getHeadlineCampaign();
  if (!campaign || !campaign.discountPercent) return null;

  return (
    <CampaignBanner
      name={campaign.name}
      discountPercent={campaign.discountPercent}
      badge={campaign.badge}
      campaignKey={`${campaign.name}:${campaign.discountPercent}`}
    />
  );
}

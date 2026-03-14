import dbConnect from "@/lib/mongodb";
import { PricingConfig, IPlan, ICampaign } from "@/models/PricingConfig";

/**
 * getPricingConfig.ts — DB-backed source of truth for all Xenode plan definitions.
 *
 * Replaces the static lib/config/plans.ts.
 * On first call, seeds the DB with the original hardcoded values.
 *
 * Used by:
 *  - app/api/payment/payu/route.ts  (server-authoritative pricing)
 *  - components/PricingComparison.tsx (public pricing page)
 *  - app/(onboarding)/onboarding/OnboardingForm.tsx (plan picker)
 *
 * NEVER derive plan prices or limits from client input.
 */

const DEFAULT_PLANS: IPlan[] = [
  {
    name: "100GB Model",
    slug: "basic",
    storage: "100 GB",
    storageLimitBytes: 100 * 1024 * 1024 * 1024,
    priceINR: 149,
    features: [
      "100 GB E2EE Storage",
      "End-to-End Encryption",
      "Global Access",
      "No Hidden Fees",
    ],
  },
  {
    name: "500GB Model",
    slug: "pro",
    storage: "500 GB",
    storageLimitBytes: 500 * 1024 * 1024 * 1024,
    priceINR: 399,
    features: [
      "500 GB E2EE Storage",
      "End-to-End Encryption",
      "Global Access",
      "No Hidden Fees",
    ],
  },
  {
    name: "1TB Model",
    slug: "plus",
    storage: "1 TB",
    storageLimitBytes: 1024 * 1024 * 1024 * 1024,
    priceINR: 699,
    isPopular: true,
    features: [
      "1 TB E2EE Storage",
      "End-to-End Encryption",
      "Priority Support",
      "Global Access",
    ],
  },
  {
    name: "2TB Model",
    slug: "max",
    storage: "2 TB",
    storageLimitBytes: 2 * 1024 * 1024 * 1024 * 1024,
    priceINR: 999,
    features: [
      "2 TB E2EE Storage",
      "End-to-End Encryption",
      "Priority Support",
      "Global Access",
    ],
  },
];

export interface PricingData {
  plans: IPlan[];
  campaign: ICampaign | null;
}

/** Server-only. Fetches from DB, seeds defaults on first call. */
export async function getPricingConfig(): Promise<PricingData> {
  await dbConnect();

  let config = await PricingConfig.findOne().lean();

  if (!config) {
    config = await PricingConfig.create({
      plans: DEFAULT_PLANS,
      campaign: null,
      updatedBy: "system",
    });
  }

  return {
    plans: config.plans as IPlan[],
    campaign: (config.campaign as ICampaign) ?? null,
  };
}

/** Returns plan by slug. Used in checkout pages. */
export async function getPlanBySlugFromDB(
  slug: string
): Promise<IPlan | undefined> {
  const { plans } = await getPricingConfig();
  return plans.find((p) => p.slug === slug);
}

/**
 * Server-authoritative map — replaces PLAN_CONFIG from plans.ts.
 * Campaign discount is applied here so PayU hash always uses real charged price.
 */
export async function getPlanConfigFromDB(): Promise<
  Record<string, { storageLimitBytes: number; priceINR: number }>
> {
  const { plans, campaign } = await getPricingConfig();

  const now = new Date();
  const activeCampaign =
    campaign?.isActive &&
    now >= new Date(campaign.startDate) &&
    now <= new Date(campaign.endDate)
      ? campaign
      : null;

  return Object.fromEntries(
    plans.map((p) => {
      const price = activeCampaign
        ? Math.round(p.priceINR * (1 - activeCampaign.discountPercent / 100))
        : p.priceINR;
      return [p.name, { storageLimitBytes: p.storageLimitBytes, priceINR: price }];
    })
  );
}

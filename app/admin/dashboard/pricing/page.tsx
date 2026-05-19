import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin/session";
import { PricingManager } from "@/components/admin/PricingManager";
import { getPricingConfig } from "@/lib/config/getPricingConfig";

export const metadata = {
  title: "Pricing | Xenode Admin",
};

export default async function PricingPage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");

  const config = await getPricingConfig();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Pricing</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Manage tier prices. Promotional campaigns live in Billing → Campaigns;
          user-typed discount codes live in Coupons.
        </p>
      </div>
      <PricingManager initialConfig={JSON.parse(JSON.stringify(config))} />
    </div>
  );
}

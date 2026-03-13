"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/client";
import { PLANS } from "@/lib/config/plans";
import { toast } from "sonner";

export default function PricingComparison() {
  const router = useRouter();
  const { data: session } = useSession();

  const handleSelectPlan = (slug: string) => {
    if (!session) {
      toast.error("Please sign in first to subscribe.");
      router.push("/sign-in");
      return;
    }
    router.push(`/checkout?plan=${slug}`);
  };

  return (
    <section className="w-full py-20 px-8">
      <div className="max-w-[1200px] mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-semibold mb-4 text-[#e8e4d9]">
            Simple, Transparent Pricing
          </h2>
          <p className="text-lg text-[#e8e4d9]/70 max-w-xl mx-auto">
            Secure your data with our End-to-End Encrypted (E2EE) platform.
            Choose the plan that fits your needs.
          </p>
        </div>

        {/* Pricing Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`relative bg-white/5 border rounded-2xl p-6 flex flex-col ${
                plan.isPopular
                  ? "border-[#7cb686] shadow-[0_0_30px_rgba(124,182,134,0.15)] bg-[#7cb686]/5"
                  : "border-white/10"
              }`}
            >
              {plan.isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#7cb686] text-[#1a2e1d] px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider whitespace-nowrap">
                  Most Popular
                </div>
              )}

              <h3 className="text-xl font-semibold text-[#e8e4d9] mb-2">{plan.name}</h3>
              <div className="mb-6 flex-1">
                <span className="text-4xl font-bold text-[#7cb686]">₹{plan.priceINR}</span>
                <span className="text-[#e8e4d9]/70">/month</span>
              </div>

              <ul className="space-y-3 text-sm text-[#e8e4d9]/80 mb-8 flex-1">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-[#7cb686] shrink-0">✓</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                onClick={() => handleSelectPlan(plan.slug)}
                className={`w-full py-6 font-semibold transition-all ${
                  plan.isPopular
                    ? "bg-[#7cb686] hover:bg-[#6ba075] text-[#1a2e1d]"
                    : "bg-white/10 hover:bg-white/20 text-[#e8e4d9]"
                }`}
              >
                Get {plan.storage} Plan
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useSession } from "@/lib/auth/client";

const plans = [
  {
    name: "100GB Model",
    storage: "100 GB",
    price: 149,
    features: [
      "100 GB E2EE Storage",
      "End-to-End Encryption",
      "Global Access",
      "No Hidden Fees",
    ],
  },
  {
    name: "500GB Model",
    storage: "500 GB",
    price: 399,
    features: [
      "500 GB E2EE Storage",
      "End-to-End Encryption",
      "Global Access",
      "No Hidden Fees",
    ],
  },
  {
    name: "1TB Model",
    storage: "1 TB",
    price: 699,
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
    storage: "2 TB",
    price: 999,
    features: [
      "2 TB E2EE Storage",
      "End-to-End Encryption",
      "Priority Support",
      "Global Access",
    ],
  },
];

export default function PricingComparison() {
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  console.log(session);

  useEffect(() => {
    const errorParam = searchParams.get("error");
    if (errorParam) {
      if (errorParam === "payment_failed") {
        toast.error("Payment failed or was cancelled. Please try again.");
      } else if (errorParam === "hash_mismatch") {
        toast.error("Security verification failed. Please try again.");
      } else if (errorParam === "server_error") {
        toast.error("An unexpected server error occurred.");
      } else {
        toast.error("An error occurred during payment.");
      }

      // Remove the error parameter from the URL cleanly
      router.replace(session ? "/dashboard/billing" : "/pricing", {
        scroll: false,
      });
    }
  }, [searchParams, router, session]);

  const handleBuyPlan = async (price: number, name: string) => {
    try {
      if (!session) {
        toast.error("Please login first to subscribe.");
        router.push("/sign-in");
        return;
      }

      setIsLoading(name);

      const response = await fetch("/api/payment/payu", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: price,
          planName: name,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to initialize payment");
      }

      // Create a form to submit to PayU
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.action;

      // Add all parameters as hidden inputs
      Object.keys(data.params).forEach((key) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = data.params[key];
        form.appendChild(input);
      });

      document.body.appendChild(form);
      form.submit();
    } catch (error) {
      console.error("Payment initialization failed:", error);
      alert("Failed to initialize payment. Please try again.");
    } finally {
      setIsLoading(null);
    }
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
          {plans.map((plan) => (
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

              <h3 className="text-xl font-semibold text-[#e8e4d9] mb-2">
                {plan.name}
              </h3>
              <div className="mb-6 flex-1">
                <span className="text-4xl font-bold text-[#7cb686]">
                  ₹{plan.price}
                </span>
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
                onClick={() => handleBuyPlan(plan.price, plan.name)}
                disabled={isLoading === plan.name}
                className={`w-full py-6 font-semibold transition-all ${
                  plan.isPopular
                    ? "bg-[#7cb686] hover:bg-[#6ba075] text-[#1a2e1d]"
                    : "bg-white/10 hover:bg-white/20 text-[#e8e4d9]"
                }`}
              >
                {isLoading === plan.name
                  ? "Processing..."
                  : `Buy ${plan.storage} Plan`}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

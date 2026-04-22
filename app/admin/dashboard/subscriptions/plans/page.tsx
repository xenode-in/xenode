"use client";

import { useEffect, useState } from "react";

interface PlanPricing {
  cycle: string;
  priceINR: number;
  razorpayPlanId?: string;
}

interface Plan {
  slug: string;
  name: string;
  pricing: PlanPricing[];
}

export default function SubscriptionPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<string>("");

  async function loadPlans() {
    const response = await fetch("/api/admin/pricing");
    const data = await response.json();
    setPlans(data?.config?.plans || []);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPlans();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function createAllPlans() {
    setCreating(true);
    setResult("");
    try {
      const response = await fetch("/api/admin/subscriptions/plans/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const data = await response.json();
      if (data.success) {
        setResult(`✅ Created ${data.created} plan(s) on Razorpay`);
        await loadPlans();
      } else {
        setResult(`❌ ${data.error || "Failed"}`);
      }
    } catch {
      setResult("❌ Request failed");
    }
    setCreating(false);
  }

  async function createPlanForSlug(slug: string) {
    setCreating(true);
    setResult("");
    try {
      const response = await fetch("/api/admin/subscriptions/plans/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planSlug: slug }),
      });
      const data = await response.json();
      if (data.success) {
        setResult(`✅ Created ${data.created} plan(s) for ${slug}`);
        await loadPlans();
      } else {
        setResult(`❌ ${data.error || "Failed"}`);
      }
    } catch {
      setResult("❌ Request failed");
    }
    setCreating(false);
  }

  const hasRealId = (id?: string) =>
    id && id.length > 15 && !id.includes("_1");

  return (
    <div className="space-y-6 text-white">
      <div>
        <h1 className="text-2xl font-bold">Subscription Plans</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Create Razorpay plans for each pricing tier. Plans must be created
          before subscriptions can be sold.
        </p>
      </div>

      {result && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm">
          {result}
        </div>
      )}

      <button
        onClick={() => void createAllPlans()}
        disabled={creating}
        className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
      >
        {creating ? "Creating…" : "Create all missing plans"}
      </button>

      <div className="space-y-4">
        {plans
          .filter((p) => p.pricing.some((e) => e.priceINR > 0))
          .map((plan) => (
            <div
              key={plan.slug}
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{plan.name}</h2>
                <button
                  onClick={() => void createPlanForSlug(plan.slug)}
                  disabled={creating}
                  className="rounded-md border border-zinc-600 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                >
                  Create plans for {plan.name}
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {plan.pricing
                  .filter((e) => e.priceINR > 0 && e.cycle !== "lifetime")
                  .map((entry) => (
                    <div
                      key={entry.cycle}
                      className="flex items-center justify-between rounded-lg bg-zinc-950 px-3 py-2 text-sm"
                    >
                      <div>
                        <span className="capitalize">{entry.cycle}</span>
                        <span className="ml-2 text-zinc-400">
                          ₹{entry.priceINR}/cycle
                        </span>
                      </div>
                      <div className="text-xs">
                        {hasRealId(entry.razorpayPlanId) ? (
                          <span className="text-green-400">
                            ✓ {entry.razorpayPlanId}
                          </span>
                        ) : entry.razorpayPlanId ? (
                          <span className="text-yellow-400">
                            ⚠ Placeholder: {entry.razorpayPlanId}
                          </span>
                        ) : (
                          <span className="text-red-400">✕ Not created</span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

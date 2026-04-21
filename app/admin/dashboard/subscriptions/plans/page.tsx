"use client";

import { useEffect, useState } from "react";

const DEFAULT_SUBSCRIPTION_PLAN_SLUG = "max";

interface BasePlanState {
  price: number;
  razorpayPlanId: string;
}

export default function SubscriptionPlansPage() {
  const [basePlan, setBasePlan] = useState<BasePlanState | null>(null);

  async function loadBasePlan() {
    const response = await fetch("/api/admin/pricing");
    const data = await response.json();
    const targetPlan = data?.config?.plans?.find(
      (plan: { slug: string }) => plan.slug === DEFAULT_SUBSCRIPTION_PLAN_SLUG,
    );
    const monthly = targetPlan?.pricing?.find((entry: { cycle: string }) => entry.cycle === "monthly");
    setBasePlan(
      monthly
        ? {
            price: monthly.priceINR,
            razorpayPlanId: monthly.razorpayPlanId || "",
          }
        : null,
    );
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadBasePlan();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  async function createPlan() {
    await fetch("/api/admin/subscriptions/plans/create", { method: "POST" });
    await loadBasePlan();
  }

  return (
    <div className="space-y-6 text-white">
      <div>
        <h1 className="text-2xl font-bold">Subscription Plans</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Manage the current base monthly recurring plan used after any first-cycle offer.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <p className="text-sm text-zinc-400">Current base plan</p>
        <p className="mt-2 text-lg font-semibold">
          {basePlan ? `Rs.${basePlan.price}/month` : "Not configured"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Razorpay plan ID: {basePlan?.razorpayPlanId || "None"}
        </p>
      </div>

      <button
        onClick={() => void createPlan()}
        className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
      >
        Create new base plan
      </button>
    </div>
  );
}

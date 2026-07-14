"use client";

import { useEffect, useState } from "react";

interface SubscriptionStatusPayload {
  status: string;
  subscription: {
    id: string;
    subscriptionId: string;
    cancelAtPeriodEnd: boolean;
    authorizationUrl: string | null;
  } | null;
  currentPeriodEnd: string | null;
  offerApplied: boolean;
  nextBillingAmount: number | null;
}

export function useSubscription() {
  const [data, setData] = useState<SubscriptionStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/subscriptions/status", {
        credentials: "include",
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error || "Failed to fetch subscription status");
      }
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch subscription status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return {
    loading,
    error,
    refresh,
    isActive: data?.status === "active",
    subscription: data?.subscription ?? null,
    currentPeriodEnd: data?.currentPeriodEnd ?? null,
    nextBillingAmount: data?.nextBillingAmount ?? null,
    status: data?.status ?? "none",
    offerApplied: data?.offerApplied ?? false,
  };
}

"use client";

import { useEffect, useState } from "react";

interface Analytics {
  mrr: number;
  arr: number;
  arpu: number;
  activeSubs: { total: number; byPlan: { plan: string; count: number }[] };
  churn: { thisMonth: number; last3Months: number };
  campaigns: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    discountPercent: number | null;
    flatDiscountPaise: number | null;
    redeemedCount: number;
    maxRedemptions: number | null;
  }[];
  couponRedemptionsThisMonth: number;
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-sm text-zinc-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export default function BillingAnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/billing/analytics");
      const json = await res.json();
      setData(json);
    })();
  }, []);

  if (!data) {
    return <p className="text-sm text-zinc-400">Loading…</p>;
  }

  return (
    <div className="space-y-6 text-white">
      <div>
        <h1 className="text-2xl font-bold">Revenue Analytics</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Live aggregates over Payment + Subscription + BillingEvent. Recomputed
          on each load.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="MRR" value={`Rs.${data.mrr.toLocaleString()}`} />
        <StatCard label="ARR" value={`Rs.${data.arr.toLocaleString()}`} />
        <StatCard label="ARPU" value={`Rs.${data.arpu.toLocaleString()}`} />
        <StatCard
          label="Active subs"
          value={data.activeSubs.total}
          hint={`${data.activeSubs.byPlan.length} plans`}
        />
        <StatCard
          label="Churn (this month)"
          value={data.churn.thisMonth}
          hint={`${data.churn.last3Months} in last 3 months`}
        />
        <StatCard
          label="Coupons redeemed"
          value={data.couponRedemptionsThisMonth}
          hint="This month"
        />
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <p className="mb-3 text-sm font-semibold text-zinc-300">
          Active subscriptions by plan
        </p>
        <ul className="space-y-1 text-sm">
          {data.activeSubs.byPlan.map((p) => (
            <li
              key={p.plan}
              className="flex items-center justify-between text-zinc-400"
            >
              <span>{p.plan}</span>
              <span className="font-mono text-zinc-200">{p.count}</span>
            </li>
          ))}
          {data.activeSubs.byPlan.length === 0 && (
            <li className="text-zinc-500">No active subscriptions</li>
          )}
        </ul>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <p className="mb-3 text-sm font-semibold text-zinc-300">
          Campaign performance
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 text-zinc-400">
              <tr>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Discount</th>
                <th className="px-2 py-2">Redeemed</th>
                <th className="px-2 py-2">Cap</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((c) => (
                <tr key={c.id} className="border-b border-zinc-800/80">
                  <td className="px-2 py-2">{c.name}</td>
                  <td className="px-2 py-2">
                    {c.discountPercent
                      ? `${c.discountPercent}%`
                      : c.flatDiscountPaise
                        ? `Rs.${(c.flatDiscountPaise / 100).toFixed(0)}`
                        : "—"}
                  </td>
                  <td className="px-2 py-2 font-mono">{c.redeemedCount}</td>
                  <td className="px-2 py-2 text-zinc-500">
                    {c.maxRedemptions ?? "∞"}
                  </td>
                  <td className="px-2 py-2">
                    {c.isActive ? (
                      <span className="text-green-400">Active</span>
                    ) : (
                      <span className="text-zinc-500">Inactive</span>
                    )}
                  </td>
                </tr>
              ))}
              {data.campaigns.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-zinc-500">
                    No campaigns
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

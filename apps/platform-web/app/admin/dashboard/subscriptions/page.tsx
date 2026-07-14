"use client";

import { useCallback, useEffect, useState } from "react";

interface SubscriptionRow {
  id: string;
  userEmail: string;
  userName: string;
  plan: string;
  status: string;
  amount: number;
  offerApplied: boolean;
  nextBilling: string;
  cancelAtPeriodEnd: boolean;
  subscriptionId: string;
}

interface SubscriptionStats {
  activeSubs: number;
  mrr: number;
  churnedThisMonth: number;
  offerSubs: number;
  regularSubs: number;
}

export default function AdminSubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [stats, setStats] = useState<SubscriptionStats | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const loadData = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status) params.set("status", status);

    const response = await fetch(`/api/admin/subscriptions?${params.toString()}`);
    const data = await response.json();
    setSubscriptions(data.subscriptions || []);
    setStats(data.stats || null);
  }, [search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadData]);

  async function cancelSubscription(id: string) {
    await fetch(`/api/admin/subscriptions/${id}/cancel`, { method: "POST" });
    await loadData();
  }

  return (
    <div className="space-y-6 text-white">
      <div>
        <h1 className="text-2xl font-bold">Subscriptions</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Active billing state, offer conversions, and manual cancellation tools.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-sm text-zinc-400">Active subs</p>
          <p className="mt-2 text-2xl font-semibold">{stats?.activeSubs ?? 0}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-sm text-zinc-400">MRR</p>
          <p className="mt-2 text-2xl font-semibold">Rs.{stats?.mrr ?? 0}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-sm text-zinc-400">Churned this month</p>
          <p className="mt-2 text-2xl font-semibold">{stats?.churnedThisMonth ?? 0}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-sm text-zinc-400">Offer vs regular</p>
          <p className="mt-2 text-2xl font-semibold">
            {stats?.offerSubs ?? 0} / {stats?.regularSubs ?? 0}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by email"
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="created">Created</option>
          <option value="authenticated">Authenticated</option>
          <option value="past_due">Past due</option>
          <option value="halted">Halted</option>
          <option value="cancelled">Cancelled</option>
          <option value="completed">Completed</option>
        </select>
        <button
          onClick={() => void loadData()}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
        >
          Apply
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-zinc-800 text-zinc-400">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Offer Applied</th>
              <th className="px-4 py-3">Next Billing</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.map((subscription) => (
              <tr key={subscription.id} className="border-b border-zinc-800/80">
                <td className="px-4 py-3">
                  <div>{subscription.userEmail}</div>
                  <div className="text-xs text-zinc-500">{subscription.userName}</div>
                </td>
                <td className="px-4 py-3">{subscription.plan}</td>
                <td className="px-4 py-3">{subscription.status}</td>
                <td className="px-4 py-3">Rs.{subscription.amount.toFixed(2)}</td>
                <td className="px-4 py-3">{subscription.offerApplied ? "Yes" : "No"}</td>
                <td className="px-4 py-3">
                  {subscription.nextBilling
                    ? new Date(subscription.nextBilling).toLocaleString()
                    : "-"}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => void cancelSubscription(subscription.id)}
                    className="rounded-md border border-red-500/30 px-3 py-1 text-xs text-red-300"
                  >
                    Force cancel
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

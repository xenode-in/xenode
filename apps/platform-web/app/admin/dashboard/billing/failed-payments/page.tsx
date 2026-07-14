"use client";

import { useCallback, useEffect, useState } from "react";

interface FailedRow {
  id: string;
  createdAt: string;
  userEmail: string;
  amount: number;
  currency: string;
  planName: string;
  billingCycle: string;
  orderId: string | null;
  paymentId: string | null;
  reason: string | null;
  gatewayCode: string | null;
}

interface ReasonBucket {
  reason: string;
  count: number;
}

export default function FailedPaymentsPage() {
  const [rows, setRows] = useState<FailedRow[]>([]);
  const [byReason, setByReason] = useState<ReasonBucket[]>([]);
  const [range, setRange] = useState("30");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ range });
    if (reason) params.set("reason", reason);
    const res = await fetch(`/api/admin/billing/failed-payments?${params}`);
    const data = await res.json();
    setRows(data.rows || []);
    setByReason(data.byReason || []);
  }, [range, reason]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 text-white">
      <div>
        <h1 className="text-2xl font-bold">Failed Payments</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Subscription charges and direct payments that failed gateway processing.
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row">
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Filter by failure reason"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        />
        <button
          onClick={() => void load()}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
        >
          Refresh
        </button>
      </div>

      {byReason.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="mb-2 text-sm font-semibold text-zinc-300">
            Top failure reasons
          </p>
          <ul className="space-y-1 text-sm">
            {byReason.map((b) => (
              <li
                key={b.reason}
                className="flex items-center justify-between text-zinc-400"
              >
                <span className="truncate">{b.reason}</span>
                <span className="ml-3 shrink-0 font-mono text-zinc-200">
                  {b.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-zinc-800 text-zinc-400">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Payment ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-800/80">
                <td className="px-4 py-3 text-zinc-300">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3">{r.userEmail}</td>
                <td className="px-4 py-3">
                  {r.planName}
                  <span className="ml-1 text-xs text-zinc-500">
                    ({r.billingCycle})
                  </span>
                </td>
                <td className="px-4 py-3">
                  {r.currency} {r.amount.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-red-300">
                  {r.reason || r.gatewayCode || "—"}
                </td>
                <td className="px-4 py-3">
                  <code className="rounded bg-zinc-800 px-1 text-xs">
                    {r.paymentId ?? r.orderId ?? "—"}
                  </code>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                  No failed payments in this range
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

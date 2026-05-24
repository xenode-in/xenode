"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldCheck } from "lucide-react";

interface RefundRow {
  id: string;
  userId: string;
  ticketId: string;
  razorpayPaymentId: string;
  amount: number;
  currency: string;
  reason: string;
  status: string;
  eligibilityWindowEndsAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  razorpayRefundId: string | null;
  refundedAt: string | null;
  createdAt: string;
}

interface CountsByStatus {
  pending: number;
  approved: number;
  processing: number;
  completed: number;
  denied: number;
  failed: number;
}

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending review" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "denied", label: "Denied" },
  { value: "failed", label: "Failed" },
  { value: "all", label: "All" },
];

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-300 border-yellow-500/20",
  approved: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  processing: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  completed: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  denied: "bg-zinc-800 text-zinc-400 border-zinc-700",
  failed: "bg-red-500/10 text-red-300 border-red-500/20",
};

function fmtAmount(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}

export default function AdminRefundsPage() {
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [counts, setCounts] = useState<CountsByStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/refunds?status=${status}&limit=100`);
    const data = await res.json();
    setRows(data.rows || []);
    setCounts(data.countsByStatus || null);
    setLoading(false);
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 text-white">
      <div>
        <h1 className="text-2xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-sm text-zinc-400">
          14-day money-back guarantee requests. Approve to initiate the Razorpay refund.
        </p>
      </div>

      {counts && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {(["pending", "approved", "processing", "completed", "denied", "failed"] as const).map(
            (k) => (
              <button
                key={k}
                onClick={() => setStatus(k)}
                className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                  status === k
                    ? "border-white/40 bg-white/5"
                    : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
                }`}
              >
                <p className="text-xs text-zinc-500 capitalize">{k}</p>
                <p className="text-xl font-semibold mt-1">{counts[k]}</p>
              </button>
            ),
          )}
        </div>
      )}

      <div className="flex gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => void load()}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
        >
          Refresh
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
        {loading ? (
          <div className="py-12 text-center">
            <Loader2 className="w-6 h-6 mx-auto animate-spin text-zinc-500" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-zinc-500">
            <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-40" />
            No refund requests in this view.
          </div>
        ) : (
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-zinc-800 text-zinc-400">
              <tr>
                <th className="px-4 py-3">Requested</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Decided</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-zinc-800/80 hover:bg-zinc-800/40 transition-colors"
                >
                  <td className="px-4 py-3 text-zinc-300">
                    {new Date(r.createdAt).toLocaleString()}
                    <p className="text-xs text-zinc-600 font-mono mt-0.5 break-all">
                      {r.razorpayPaymentId}
                    </p>
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {fmtAmount(r.amount, r.currency)}
                  </td>
                  <td className="px-4 py-3 text-zinc-300 max-w-[280px]">
                    <p className="line-clamp-2">{r.reason}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
                        STATUS_STYLE[r.status] ?? STATUS_STYLE.pending
                      }`}
                    >
                      {r.status}
                    </span>
                    {r.razorpayRefundId && (
                      <p className="text-xs text-zinc-600 font-mono mt-1 break-all">
                        {r.razorpayRefundId}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">
                    {r.decidedAt ? (
                      <>
                        <p>{new Date(r.decidedAt).toLocaleDateString()}</p>
                        <p className="text-zinc-600">by {r.decidedBy}</p>
                      </>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/dashboard/billing/refunds/${r.id}`}
                      className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-zinc-200"
                    >
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

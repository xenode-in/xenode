"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, MessageSquare, AlertTriangle } from "lucide-react";

interface TicketRow {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  replyCount: number;
  lastReplyAt: string;
  lastReplyBy: string;
  refundRequestId: string | null;
  assignedAdminId: string | null;
  createdAt: string;
}

const STATUS_OPTIONS = [
  { value: "", label: "All open" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "awaiting_user", label: "Awaiting user" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const CATEGORY_OPTIONS = [
  { value: "", label: "All categories" },
  { value: "refund_request", label: "Refund requests" },
  { value: "billing", label: "Billing" },
  { value: "technical", label: "Technical" },
  { value: "account", label: "Account" },
  { value: "general", label: "General" },
];

const STATUS_STYLE: Record<string, string> = {
  open: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  in_progress: "bg-yellow-500/10 text-yellow-300 border-yellow-500/20",
  awaiting_user: "bg-orange-500/10 text-orange-300 border-orange-500/20",
  resolved: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  closed: "bg-zinc-800 text-zinc-400 border-zinc-700",
};

const PRIORITY_STYLE: Record<string, string> = {
  urgent: "bg-red-500/10 text-red-300 border-red-500/20",
  high: "bg-orange-500/10 text-orange-300 border-orange-500/20",
  normal: "bg-zinc-800 text-zinc-400 border-zinc-700",
  low: "bg-zinc-800 text-zinc-500 border-zinc-700",
};

function timeAgo(date: string): string {
  const ms = Date.now() - new Date(date).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default function AdminSupportPage() {
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [urgentCount, setUrgentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    // No status filter → show open + in_progress + awaiting_user (most actionable)
    if (status) params.set("status", status);
    if (category) params.set("category", category);
    if (search) params.set("search", search);
    params.set("limit", "100");

    const res = await fetch(`/api/admin/support/tickets?${params}`);
    const data = await res.json();
    let filtered = data.rows || [];
    if (!status) {
      filtered = filtered.filter((r: TicketRow) =>
        ["open", "in_progress", "awaiting_user"].includes(r.status),
      );
    }
    setRows(filtered);
    setOpenCount(data.openCount || 0);
    setUrgentCount(data.urgentCount || 0);
    setLoading(false);
  }, [status, category, search]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 text-white">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Support Tickets</h1>
          <p className="mt-1 text-sm text-zinc-400">
            User support requests including refund inquiries.
          </p>
        </div>
        <div className="flex gap-3 text-right">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2">
            <p className="text-xs text-zinc-500">Open</p>
            <p className="text-xl font-semibold">{openCount}</p>
          </div>
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 px-4 py-2">
            <p className="text-xs text-orange-400 flex items-center gap-1 justify-end">
              <AlertTriangle className="w-3 h-3" /> Urgent
            </p>
            <p className="text-xl font-semibold text-orange-300">{urgentCount}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row">
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
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        >
          {CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search subject, email, or name"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        />
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
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
            No tickets match these filters.
          </div>
        ) : (
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-zinc-800 text-zinc-400">
              <tr>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-zinc-800/80 hover:bg-zinc-800/40 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/dashboard/support/${r.id}`}
                      className="block hover:text-white"
                    >
                      <p className="font-medium text-white truncate max-w-[320px]">
                        {r.subject}
                      </p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        #{r.id.slice(-8)} ·{" "}
                        {r.replyCount + 1} {r.replyCount + 1 === 1 ? "msg" : "msgs"}
                        {r.refundRequestId && (
                          <span className="ml-2 text-orange-400">· Refund linked</span>
                        )}
                      </p>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-white truncate max-w-[200px]">{r.userName}</p>
                    <p className="text-xs text-zinc-500 truncate max-w-[200px]">
                      {r.userEmail}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">
                    {r.category.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
                        STATUS_STYLE[r.status] ?? STATUS_STYLE.open
                      }`}
                    >
                      {r.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
                        PRIORITY_STYLE[r.priority] ?? PRIORITY_STYLE.normal
                      }`}
                    >
                      {r.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    <span title={new Date(r.lastReplyAt).toLocaleString()}>
                      {timeAgo(r.lastReplyAt)}
                    </span>
                    {r.lastReplyBy === "user" && r.status !== "closed" && (
                      <span className="block text-xs text-orange-400 mt-0.5">
                        ← User replied
                      </span>
                    )}
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

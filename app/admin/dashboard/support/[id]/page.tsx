"use client";

import { useCallback, useEffect, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Send, Shield, MessageSquare, ExternalLink } from "lucide-react";

interface Reply {
  id: string;
  authorType: "user" | "admin" | "system";
  authorName: string;
  authorId: string;
  message: string;
  isInternal: boolean;
  createdAt: string;
}

interface AdminTicket {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  subject: string;
  description: string;
  category: string;
  status: string;
  priority: string;
  refundRequestId: string | null;
  assignedAdminId: string | null;
  replies: Reply[];
  createdAt: string;
  lastReplyAt: string;
  lastReplyBy: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  closedAt: string | null;
  metadata: Record<string, unknown>;
}

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "awaiting_user", label: "Awaiting user" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export default function AdminTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [ticket, setTicket] = useState<AdminTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/support/tickets/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setTicket(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ticket");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateField(field: "status" | "priority", value: string) {
    try {
      const res = await fetch(`/api/admin/support/tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    }
  }

  async function submitReply(e: React.FormEvent) {
    e.preventDefault();
    if (reply.trim().length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/support/tickets/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply, isInternal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      setReply("");
      setIsInternal(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="max-w-4xl mx-auto text-white">
        <Link
          href="/admin/dashboard/support"
          className="inline-flex items-center text-sm text-zinc-400 hover:text-white mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Link>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {error || "Ticket not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5 text-white">
      <Link
        href="/admin/dashboard/support"
        className="inline-flex items-center text-sm text-zinc-400 hover:text-white"
      >
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to tickets
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <h1 className="text-xl font-semibold">{ticket.subject}</h1>
            <p className="text-xs text-zinc-500 mt-1">
              #{ticket.id.slice(-8)} · Opened {new Date(ticket.createdAt).toLocaleString()}
            </p>
            <div className="mt-4 text-sm text-zinc-200 whitespace-pre-wrap break-words">
              {ticket.description}
            </div>
          </div>

          <div className="space-y-3">
            {ticket.replies.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
                <MessageSquare className="w-5 h-5 mx-auto mb-2 opacity-40" />
                No replies yet.
              </div>
            ) : (
              ticket.replies.map((r) => (
                <div
                  key={r.id}
                  className={`rounded-xl border p-4 ${
                    r.isInternal
                      ? "border-yellow-500/30 bg-yellow-500/5"
                      : r.authorType === "user"
                        ? "border-zinc-800 bg-zinc-900"
                        : r.authorType === "system"
                          ? "border-zinc-800 bg-zinc-900/50"
                          : "border-emerald-500/20 bg-emerald-500/5"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2 text-xs">
                    <span className="font-medium">
                      {r.authorType === "user" ? (
                        <span className="text-zinc-300">{r.authorName} (User)</span>
                      ) : r.authorType === "system" ? (
                        <span className="text-zinc-400">{r.authorName}</span>
                      ) : (
                        <span className="text-emerald-300">
                          {r.authorName} (Admin)
                          {r.isInternal && (
                            <span className="ml-2 text-yellow-400">[Internal note]</span>
                          )}
                        </span>
                      )}
                    </span>
                    <span className="text-zinc-500">
                      {new Date(r.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-100 whitespace-pre-wrap break-words">
                    {r.message}
                  </p>
                </div>
              ))
            )}
          </div>

          {ticket.status !== "closed" && (
            <form
              onSubmit={submitReply}
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3"
            >
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={isInternal ? "Internal note (not visible to user)…" : "Reply to user…"}
                rows={5}
                maxLength={8000}
                className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                  isInternal
                    ? "border-yellow-500/30 bg-yellow-500/5"
                    : "border-zinc-700 bg-zinc-950"
                }`}
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isInternal}
                    onChange={(e) => setIsInternal(e.target.checked)}
                    className="rounded border-zinc-700"
                  />
                  Internal note (admins only)
                </label>
                <button
                  type="submit"
                  disabled={submitting || reply.trim().length === 0}
                  className="inline-flex items-center rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-2" />
                  )}
                  Send
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">User</p>
            <div>
              <p className="text-sm text-white">{ticket.userName}</p>
              <p className="text-xs text-zinc-400 break-all">{ticket.userEmail}</p>
              <p className="text-xs text-zinc-600 mt-1 font-mono break-all">
                {ticket.userId}
              </p>
            </div>
            <Link
              href={`/admin/dashboard/users/${ticket.userId}`}
              className="inline-flex items-center text-xs text-emerald-400 hover:underline"
            >
              View user <ExternalLink className="w-3 h-3 ml-1" />
            </Link>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Status</p>
            <select
              value={ticket.status}
              onChange={(e) => void updateField("status", e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <p className="text-xs text-zinc-500 uppercase tracking-wider mt-2">Priority</p>
            <select
              value={ticket.priority}
              onChange={(e) => void updateField("priority", e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            >
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <p className="text-xs text-zinc-500 uppercase tracking-wider mt-2">Category</p>
            <p className="text-sm text-zinc-200">{ticket.category.replace(/_/g, " ")}</p>

            {ticket.assignedAdminId && (
              <>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mt-2">
                  Assigned
                </p>
                <p className="text-sm text-zinc-200 font-mono break-all">
                  {ticket.assignedAdminId}
                </p>
              </>
            )}
          </div>

          {ticket.refundRequestId && (
            <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 space-y-2">
              <p className="text-xs text-orange-400 uppercase tracking-wider flex items-center gap-1">
                <Shield className="w-3 h-3" /> Linked refund
              </p>
              <Link
                href={`/admin/dashboard/billing/refunds/${ticket.refundRequestId}`}
                className="inline-flex items-center text-sm text-orange-300 hover:underline"
              >
                Open refund request
                <ExternalLink className="w-3 h-3 ml-1" />
              </Link>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm px-4 py-3">
          {error}
        </div>
      )}
    </div>
  );
}

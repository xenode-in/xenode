"use client";

import { useCallback, useEffect, useState } from "react";
import { use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Clock,
  ShieldCheck,
} from "lucide-react";

interface RefundDetail {
  id: string;
  userId: string;
  ticketId: string;
  razorpayPaymentId: string;
  razorpaySubscriptionId: string | null;
  amount: number;
  currency: string;
  reason: string;
  status: string;
  eligibilityWindowEndsAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  razorpayRefundId: string | null;
  refundedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  payment: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    planName: string;
    billingCycle: string;
    method?: string;
    paidAt: string;
    subscriptionStartDate: string;
    subscriptionEndDate: string;
    refund_id?: string | null;
    refund_status?: string | null;
  } | null;
  ticket: {
    id: string;
    subject: string;
    status: string;
    userEmail: string;
    userName: string;
  } | null;
}

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-300 border-yellow-500/20",
  approved: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  processing: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  completed: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  denied: "bg-zinc-800 text-zinc-400 border-zinc-700",
  failed: "bg-red-500/10 text-red-300 border-red-500/20",
};

export default function AdminRefundDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [refund, setRefund] = useState<RefundDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [approveNote, setApproveNote] = useState("");
  const [denyReason, setDenyReason] = useState("");
  const [actionLoading, setActionLoading] = useState<"approve" | "deny" | null>(
    null,
  );
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showDenyForm, setShowDenyForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/refunds/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setRefund(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve() {
    if (actionLoading) return;
    setActionLoading("approve");
    setError(null);
    try {
      const res = await fetch(`/api/admin/refunds/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: approveNote || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to approve");
      setShowApproveConfirm(false);
      setApproveNote("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setActionLoading(null);
    }
  }

  async function deny() {
    if (actionLoading) return;
    if (denyReason.trim().length < 5) {
      setError("Please provide a reason (at least 5 characters).");
      return;
    }
    setActionLoading("deny");
    setError(null);
    try {
      const res = await fetch(`/api/admin/refunds/${id}/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: denyReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to deny");
      setShowDenyForm(false);
      setDenyReason("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deny");
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (error && !refund) {
    return (
      <div className="text-white">
        <Link
          href="/admin/dashboard/billing/refunds"
          className="inline-flex items-center text-sm text-zinc-400 hover:text-white mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Link>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {error}
        </div>
      </div>
    );
  }

  if (!refund) return null;

  const isPending = refund.status === "pending";
  const windowDays = Math.ceil(
    (new Date(refund.eligibilityWindowEndsAt).getTime() -
      new Date(refund.createdAt).getTime()) /
      (1000 * 60 * 60 * 24),
  );
  const windowExpired =
    new Date(refund.eligibilityWindowEndsAt).getTime() < Date.now();

  return (
    <div className="max-w-5xl mx-auto space-y-5 text-white">
      <Link
        href="/admin/dashboard/billing/refunds"
        className="inline-flex items-center text-sm text-zinc-400 hover:text-white"
      >
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to refunds
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            Refund · {refund.currency} {refund.amount.toFixed(2)}
          </h1>
          <p className="text-xs text-zinc-500 mt-1 font-mono">{refund.id}</p>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-3 py-1 text-sm ${
            STATUS_STYLE[refund.status] ?? STATUS_STYLE.pending
          }`}
        >
          {refund.status}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">
              User&apos;s reason
            </p>
            <p className="text-sm text-zinc-100 whitespace-pre-wrap break-words">
              {refund.reason}
            </p>
          </div>

          {refund.payment && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-3">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">Payment</p>
              <dl className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                <dt className="text-zinc-400">Plan</dt>
                <dd className="text-zinc-100">
                  {refund.payment.planName} ({refund.payment.billingCycle})
                </dd>
                <dt className="text-zinc-400">Amount</dt>
                <dd className="text-zinc-100">
                  {refund.payment.currency} {refund.payment.amount.toFixed(2)}
                </dd>
                <dt className="text-zinc-400">Payment status</dt>
                <dd className="text-zinc-100">{refund.payment.status}</dd>
                {refund.payment.method && (
                  <>
                    <dt className="text-zinc-400">Method</dt>
                    <dd className="text-zinc-100">{refund.payment.method}</dd>
                  </>
                )}
                <dt className="text-zinc-400">Paid on</dt>
                <dd className="text-zinc-100">
                  {new Date(refund.payment.paidAt).toLocaleString()}
                </dd>
                <dt className="text-zinc-400">Razorpay payment</dt>
                <dd className="text-zinc-100 font-mono text-xs break-all">
                  {refund.razorpayPaymentId}
                </dd>
                {refund.razorpaySubscriptionId && (
                  <>
                    <dt className="text-zinc-400">Razorpay subscription</dt>
                    <dd className="text-zinc-100 font-mono text-xs break-all">
                      {refund.razorpaySubscriptionId}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {/* Decision history */}
          {refund.decidedAt && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-2">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">Decision</p>
              <p className="text-sm text-zinc-200">
                <span className="capitalize">{refund.status}</span> by{" "}
                <strong>{refund.decidedBy}</strong> on{" "}
                {new Date(refund.decidedAt).toLocaleString()}
              </p>
              {refund.decisionNote && (
                <p className="text-sm text-zinc-300 mt-2 whitespace-pre-wrap break-words">
                  {refund.decisionNote}
                </p>
              )}
              {refund.razorpayRefundId && (
                <p className="text-xs text-zinc-500 mt-2">
                  Razorpay refund ID:{" "}
                  <span className="font-mono text-zinc-300">
                    {refund.razorpayRefundId}
                  </span>
                </p>
              )}
              {refund.refundedAt && (
                <p className="text-xs text-zinc-500">
                  Settled at: {new Date(refund.refundedAt).toLocaleString()}
                </p>
              )}
              {refund.failureReason && (
                <p className="text-sm text-red-300 mt-2">
                  Failure: {refund.failureReason}
                </p>
              )}
            </div>
          )}

          {/* Action panel */}
          {isPending && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
              <div>
                <p className="text-sm font-medium">Take action</p>
                <p className="text-xs text-zinc-500 mt-1">
                  Approving will call Razorpay&apos;s refund API and cancel the subscription.
                  Denying will close the request and notify the user.
                </p>
              </div>

              {!showApproveConfirm && !showDenyForm && (
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowApproveConfirm(true)}
                    className="inline-flex items-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" /> Approve refund
                  </button>
                  <button
                    onClick={() => setShowDenyForm(true)}
                    className="inline-flex items-center rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
                  >
                    <XCircle className="w-4 h-4 mr-2" /> Deny
                  </button>
                </div>
              )}

              {showApproveConfirm && (
                <div className="space-y-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                  <p className="text-sm text-emerald-100">
                    Confirm: refund <strong>{refund.currency} {refund.amount.toFixed(2)}</strong>{" "}
                    and cancel the subscription? This cannot be undone.
                  </p>
                  <textarea
                    value={approveNote}
                    onChange={(e) => setApproveNote(e.target.value)}
                    placeholder="Optional internal note about this decision…"
                    rows={2}
                    maxLength={2000}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={approve}
                      disabled={actionLoading !== null}
                      className="inline-flex items-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {actionLoading === "approve" ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                      )}
                      Confirm approve
                    </button>
                    <button
                      onClick={() => {
                        setShowApproveConfirm(false);
                        setApproveNote("");
                      }}
                      disabled={actionLoading !== null}
                      className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {showDenyForm && (
                <div className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-950 p-4">
                  <p className="text-sm text-zinc-200">
                    Reason for denial (visible to user):
                  </p>
                  <textarea
                    value={denyReason}
                    onChange={(e) => setDenyReason(e.target.value)}
                    placeholder="e.g. Outside the 14-day window, or terms of service violation."
                    rows={4}
                    maxLength={2000}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={deny}
                      disabled={actionLoading !== null || denyReason.trim().length < 5}
                      className="inline-flex items-center rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {actionLoading === "deny" ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <XCircle className="w-4 h-4 mr-2" />
                      )}
                      Confirm deny
                    </button>
                    <button
                      onClick={() => {
                        setShowDenyForm(false);
                        setDenyReason("");
                      }}
                      disabled={actionLoading !== null}
                      className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm px-4 py-3">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          {refund.ticket && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">User</p>
              <div>
                <p className="text-sm">{refund.ticket.userName}</p>
                <p className="text-xs text-zinc-400 break-all">
                  {refund.ticket.userEmail}
                </p>
                <p className="text-xs text-zinc-600 mt-1 font-mono break-all">
                  {refund.userId}
                </p>
              </div>
              <Link
                href={`/admin/dashboard/users/${refund.userId}`}
                className="inline-flex items-center text-xs text-emerald-400 hover:underline"
              >
                View user <ExternalLink className="w-3 h-3 ml-1" />
              </Link>
            </div>
          )}

          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">
              Eligibility
            </p>
            <div className="text-sm space-y-1">
              <p className="text-zinc-300 flex items-center gap-2">
                {windowExpired ? (
                  <>
                    <Clock className="w-4 h-4 text-orange-400" />
                    Window expired
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Within window
                  </>
                )}
              </p>
              <p className="text-xs text-zinc-500">
                {windowDays}-day window ends{" "}
                {new Date(refund.eligibilityWindowEndsAt).toLocaleString()}
              </p>
            </div>
          </div>

          {refund.ticket && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">
                Linked ticket
              </p>
              <Link
                href={`/admin/dashboard/support/${refund.ticket.id}`}
                className="block text-sm text-zinc-100 hover:underline"
              >
                {refund.ticket.subject}
              </Link>
              <p className="text-xs text-zinc-500">
                #{refund.ticket.id.slice(-8)} · {refund.ticket.status}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

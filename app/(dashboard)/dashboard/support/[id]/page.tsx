"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { use } from "react";
import { ArrowLeft, Loader2, Send, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Reply {
  id: string;
  authorType: "user" | "admin" | "system";
  authorName: string;
  message: string;
  createdAt: string;
}

interface Ticket {
  id: string;
  subject: string;
  description: string;
  category: string;
  status: string;
  priority: string;
  refundRequestId: string | null;
  replies: Reply[];
  createdAt: string;
  lastReplyAt: string;
  lastReplyBy: string;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  open: {
    label: "Open",
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  },
  in_progress: {
    label: "In Progress",
    className:
      "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
  },
  awaiting_user: {
    label: "Awaiting You",
    className: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  },
  resolved: {
    label: "Resolved",
    className: "bg-primary/10 text-primary border-primary/20",
  },
  closed: {
    label: "Closed",
    className: "bg-muted text-muted-foreground border-border",
  },
};

const CATEGORY_LABELS: Record<string, string> = {
  refund_request: "Refund Request",
  billing: "Billing",
  technical: "Technical",
  account: "Account",
  general: "General",
};

export default function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/support/tickets/${id}`);
      if (res.status === 404) {
        setError("Ticket not found.");
        setLoading(false);
        return;
      }
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

  async function submitReply(e: React.FormEvent) {
    e.preventDefault();
    if (reply.trim().length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/support/tickets/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send reply");
      setReply("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="max-w-3xl mx-auto">
        <Link
          href="/dashboard/support"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to support
        </Link>
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center text-sm text-destructive">
          {error || "Ticket not found."}
        </div>
      </div>
    );
  }

  const statusInfo = STATUS_LABELS[ticket.status] ?? STATUS_LABELS.open;
  const isClosed = ticket.status === "closed";

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <Link
        href="/dashboard/support"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to support
      </Link>

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                {CATEGORY_LABELS[ticket.category] ?? ticket.category}
              </span>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded border ${statusInfo.className}`}
              >
                {statusInfo.label}
              </span>
            </div>
            <h1 className="text-xl font-semibold text-foreground">
              {ticket.subject}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              #{ticket.id.slice(-8)} · Opened{" "}
              {new Date(ticket.createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap break-words">
          {ticket.description}
        </div>
      </div>

      {/* Replies */}
      {ticket.replies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          <MessageSquare className="w-5 h-5 mx-auto mb-2 opacity-40" />
          No replies yet. Our team will respond as soon as possible.
        </div>
      ) : (
        <ul className="space-y-3">
          {ticket.replies.map((r) => (
            <li
              key={r.id}
              className={`rounded-xl border p-4 ${
                r.authorType === "user"
                  ? "border-border bg-card"
                  : r.authorType === "system"
                    ? "border-border bg-muted/30"
                    : "border-primary/20 bg-primary/5"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium">
                  {r.authorType === "user" ? (
                    <span className="text-muted-foreground">You</span>
                  ) : r.authorType === "system" ? (
                    <span className="text-muted-foreground">{r.authorName}</span>
                  ) : (
                    <span className="text-primary">{r.authorName} (Support)</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                {r.message}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* Reply form */}
      {isClosed ? (
        <div className="rounded-xl border border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
          This ticket is closed. Open a new ticket if you need further help.
        </div>
      ) : (
        <form
          onSubmit={submitReply}
          className="rounded-xl border border-border bg-card p-4 space-y-3"
        >
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write a reply…"
            rows={4}
            maxLength={8000}
          />
          <div className="flex items-center justify-end">
            <Button type="submit" disabled={submitting || reply.trim().length === 0}>
              {submitting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Send reply
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

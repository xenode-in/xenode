import Link from "next/link";
import { requireAuth } from "@/lib/auth/session";
import { listUserTickets } from "@/lib/support/tickets";
import { MessageSquare, Plus, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

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
    className:
      "bg-primary/10 text-primary border-primary/20",
  },
  closed: {
    label: "Closed",
    className: "bg-muted text-muted-foreground border-border",
  },
};

const CATEGORY_LABELS: Record<string, string> = {
  refund_request: "Refund",
  billing: "Billing",
  technical: "Technical",
  account: "Account",
  general: "General",
};

function timeAgo(date: Date): string {
  const ms = Date.now() - new Date(date).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(date).toLocaleDateString();
}

export default async function SupportPage() {
  const session = await requireAuth();
  const { rows } = await listUserTickets({ userId: session.user.id });

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Support</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Get help, track your tickets, or request a refund.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/support/new">
            <Plus className="w-4 h-4 mr-2" />
            New ticket
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <MessageSquare className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
          <h3 className="text-base font-medium text-foreground">No tickets yet</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-6">
            Need help with something? Open a ticket and we&apos;ll get back to you.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button asChild>
              <Link href="/dashboard/support/new">Create a ticket</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard/billing">
                <RefreshCcw className="w-4 h-4 mr-2" />
                Request refund
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <ul className="divide-y divide-border">
            {rows.map((t) => {
              const statusInfo = STATUS_LABELS[t.status] ?? STATUS_LABELS.open;
              return (
                <li key={String(t._id)}>
                  <Link
                    href={`/dashboard/support/${String(t._id)}`}
                    className="block px-5 py-4 hover:bg-accent/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                            {CATEGORY_LABELS[t.category] ?? t.category}
                          </span>
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded border ${statusInfo.className}`}
                          >
                            {statusInfo.label}
                          </span>
                          {t.lastReplyBy === "admin" && t.status === "awaiting_user" && (
                            <span className="text-xs font-medium text-primary">
                              ● New reply
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-medium text-foreground truncate">
                          {t.subject}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          #{String(t._id).slice(-8)} ·{" "}
                          {(t.replies?.length ?? 0) + 1}{" "}
                          {(t.replies?.length ?? 0) + 1 === 1 ? "message" : "messages"}{" "}
                          · Updated {timeAgo(t.lastReplyAt)}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

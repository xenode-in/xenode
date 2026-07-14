"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, ShieldQuestion, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface AccessRequestRow {
  id: string;
  directShareId: string;
  requesterEmail: string | null;
  currentRole: string;
  requestedRole: string;
  note: string | null;
  status: string;
  createdAt: string;
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data as T;
}

/**
 * Incoming access-request inbox for a share owner / org admin. Approving flips
 * the recipient's role on the underlying share. Renders nothing when there are
 * no pending requests, so it stays out of the way. `onDecided` lets the host
 * refresh its share list after an approval.
 */
export function ShareAccessRequestsInbox({
  onDecided,
}: {
  onDecided?: () => void;
}) {
  const [rows, setRows] = useState<AccessRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await readJson<{ requests: AccessRequestRow[] }>(
        await fetch("/api/direct-shares/access-requests?box=incoming&status=pending"),
      );
      setRows(data.requests);
    } catch {
      /* silent — inbox is auxiliary */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, decision: "approve" | "deny") {
    setBusy(`${decision}-${id}`);
    try {
      await readJson(
        await fetch(`/api/direct-shares/access-requests/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        }),
      );
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast.success(decision === "approve" ? "Access granted" : "Request declined");
      onDecided?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to decide");
    } finally {
      setBusy(null);
    }
  }

  if (loading || rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
        <ShieldQuestion className="h-4 w-4 text-primary" />
        Access requests
        <Badge variant="secondary">{rows.length}</Badge>
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 text-sm">
              <span className="font-medium text-foreground">
                {r.requesterEmail || "A recipient"}
              </span>{" "}
              <span className="text-muted-foreground">
                requests <span className="capitalize">{r.requestedRole}</span> access
              </span>
              {r.note && (
                <p className="truncate text-xs text-muted-foreground">“{r.note}”</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => decide(r.id, "approve")}
                disabled={busy !== null}
              >
                {busy === `approve-${r.id}` ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => decide(r.id, "deny")}
                disabled={busy !== null}
              >
                {busy === `deny-${r.id}` ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                Deny
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

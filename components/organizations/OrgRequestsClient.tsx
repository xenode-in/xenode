"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, X, Send, GitPullRequest } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/utils";
import type { OrgRole } from "@/lib/auth/organization";

interface AccessRequestRow {
  id: string;
  requesterUserId: string;
  resourceType: string;
  resourceId: string | null;
  note: string | null;
  status: "pending" | "approved" | "denied";
  createdAt: string;
}

const RESOURCE_TYPES = ["object", "bucket", "team", "org_membership"] as const;

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data as T;
}

function statusBadge(status: AccessRequestRow["status"]) {
  const variant = status === "approved" ? "default" : status === "denied" ? "destructive" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

export function OrgRequestsClient({ orgId }: { orgId: string; role: OrgRole }) {
  const [requests, setRequests] = useState<AccessRequestRow[]>([]);
  const [canTriage, setCanTriage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [resourceType, setResourceType] = useState<string>("object");
  const [resourceId, setResourceId] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await readJson<{ requests: AccessRequestRow[]; canTriage: boolean }>(
        await fetch(`/api/orgs/${orgId}/access-requests`),
      );
      setRequests(data.requests);
      setCanTriage(data.canTriage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load requests");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitRequest() {
    setBusy("create");
    try {
      await readJson(
        await fetch(`/api/orgs/${orgId}/access-requests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resourceType,
            resourceId: resourceId.trim() || null,
            note: note.trim() || null,
          }),
        }),
      );
      setResourceId("");
      setNote("");
      toast.success("Access request submitted");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit request");
    } finally {
      setBusy(null);
    }
  }

  async function decide(id: string, decision: "approve" | "deny") {
    setBusy(`${decision}-${id}`);
    try {
      await readJson(
        await fetch(`/api/orgs/${orgId}/access-requests/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        }),
      );
      toast.success(decision === "approve" ? "Request approved" : "Request denied");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to decide request");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {canTriage
            ? "Review and act on access requests from your team."
            : "Ask for access to a resource; an admin will review it."}
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-sm font-medium">Request access</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={resourceType} onValueChange={setResourceType}>
            <SelectTrigger className="sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESOURCE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            placeholder="Resource id (optional)"
          />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
          />
          <Button onClick={submitRequest} disabled={busy !== null}>
            {busy === "create" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Request
          </Button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-foreground">
          {canTriage ? "All requests" : "Your requests"}
        </h2>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
            <GitPullRequest className="mb-3 h-7 w-7 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No requests.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">
                    {r.resourceType.replace("_", " ")}
                    {r.resourceId && (
                      <span className="ml-1 text-xs text-muted-foreground">#{r.resourceId}</span>
                    )}
                  </p>
                  {r.note && <p className="truncate text-xs text-muted-foreground">{r.note}</p>}
                  <p className="text-[11px] text-muted-foreground/70">{formatDate(r.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {statusBadge(r.status)}
                  {canTriage && r.status === "pending" && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-primary hover:bg-primary/10"
                        onClick={() => decide(r.id, "approve")}
                        disabled={busy !== null}
                      >
                        {busy === `approve-${r.id}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                        onClick={() => decide(r.id, "deny")}
                        disabled={busy !== null}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

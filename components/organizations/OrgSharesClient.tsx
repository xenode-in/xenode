"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Users, Inbox, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  OrgPageHeader,
  OrgLoading,
  OrgEmptyState,
} from "@/components/organizations/org-ui";
import { formatDate } from "@/lib/utils";

interface ShareRow {
  id: string;
  objectId: string;
  type: "link" | "direct";
  createdBy: string | null;
  recipientCount?: number | null;
  accessType?: string;
  createdAt: string | null;
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data as T;
}

export function OrgSharesClient({
  orgId,
  scope,
}: {
  orgId: string;
  scope: "shared" | "with-me";
}) {
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [restricted, setRestricted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/shares?scope=${scope}`);
      if (res.status === 403) {
        setRestricted(true);
        return;
      }
      const data = await readJson<{ shares: ShareRow[] }>(res);
      setShares(data.shares);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load shares");
    } finally {
      setLoading(false);
    }
  }, [orgId, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const isWithMe = scope === "with-me";

  if (loading) return <OrgLoading />;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <OrgPageHeader
        title={isWithMe ? "Shared With Me" : "Shared"}
        description={
          isWithMe
            ? "Organization files explicitly shared with you."
            : "Organization files shared via links or direct shares."
        }
      />

      {restricted ? (
        <OrgEmptyState icon={Share2} title="Limited access" description="Sharing isn't available for your role." />
      ) : shares.length === 0 ? (
        <OrgEmptyState
          icon={isWithMe ? Inbox : Share2}
          title={isWithMe ? "Nothing shared with you yet" : "Nothing shared yet"}
          description={
            isWithMe
              ? "Files an admin or teammate shares with you will appear here."
              : "Share links and direct shares of org files will appear here."
          }
        />
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card">
          {shares.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary/50 text-muted-foreground">
                {s.type === "link" ? <Link2 className="h-4 w-4" /> : <Users className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">Encrypted file</p>
                <p className="text-xs text-muted-foreground">
                  {s.type === "link" ? "Public link" : "Direct share"}
                  {typeof s.recipientCount === "number" && ` · ${s.recipientCount} recipient${s.recipientCount === 1 ? "" : "s"}`}
                  {s.createdAt && ` · ${formatDate(s.createdAt)}`}
                </p>
              </div>
              {s.accessType && <Badge variant="secondary" className="capitalize">{s.accessType}</Badge>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

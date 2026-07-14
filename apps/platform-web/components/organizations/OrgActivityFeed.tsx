"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Building2,
  UserPlus,
  UserCheck,
  UserMinus,
  Globe,
  ShieldCheck,
  ShieldAlert,
  FolderPlus,
  Upload,
  CreditCard,
  Users2,
  Loader2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatDate } from "@/lib/utils";

interface ActivityItem {
  id: string;
  action: string;
  actorUserId: string | null;
  actorType: string;
  target: { type: string; id: string | null } | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const ACTION_META: Record<string, { label: string; icon: LucideIcon }> = {
  "org.created": { label: "Organization created", icon: Building2 },
  "org.settings_updated": { label: "Settings updated", icon: Building2 },
  "org.ownership_transferred": { label: "Ownership transferred", icon: Users2 },
  "member.invited": { label: "Member invited", icon: UserPlus },
  "member.joined": { label: "Member joined", icon: UserCheck },
  "member.invite_rejected": { label: "Invitation declined", icon: UserMinus },
  "member.removed": { label: "Member removed", icon: UserMinus },
  "member.role_changed": { label: "Role changed", icon: Users2 },
  "team.created": { label: "Team created", icon: Users2 },
  "team.deleted": { label: "Team deleted", icon: Users2 },
  "domain.added": { label: "Domain added", icon: Globe },
  "domain.verified": { label: "Domain verified", icon: ShieldCheck },
  "domain.verification_failed": { label: "Domain verification failed", icon: ShieldAlert },
  "bucket.created": { label: "Space created", icon: FolderPlus },
  "file.uploaded": { label: "File uploaded", icon: Upload },
  "file.deleted": { label: "File deleted", icon: Upload },
  "billing.checkout_started": { label: "Checkout started", icon: CreditCard },
  "billing.seats_changed": { label: "Seats changed", icon: CreditCard },
};

function metaLabel(item: ActivityItem): string {
  const m = item.metadata || {};
  const bits: string[] = [];
  if (typeof m.role === "string") bits.push(m.role);
  if (typeof m.domain === "string") bits.push(m.domain);
  if (typeof m.planSlug === "string") bits.push(String(m.planSlug));
  if (typeof m.seats === "number") bits.push(`${m.seats} seats`);
  if (typeof m.sizeBucket === "string") bits.push(String(m.sizeBucket));
  return bits.join(" · ");
}

export function OrgActivityFeed({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextCursor: string | null) => {
      const params = new URLSearchParams();
      if (nextCursor) params.set("cursor", nextCursor);
      const res = await fetch(
        `/api/orgs/${orgId}/activity${params.toString() ? `?${params}` : ""}`,
      );
      if (!res.ok) {
        throw new Error(
          res.status === 403
            ? "You don't have access to the activity feed."
            : "Failed to load activity.",
        );
      }
      return (await res.json()) as {
        items: ActivityItem[];
        nextCursor: string | null;
      };
    },
    [orgId],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    load(null)
      .then((data) => {
        if (!active) return;
        setItems(data.items);
        setCursor(data.nextCursor);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await load(cursor);
      setItems((prev) => [...prev, ...data.items]);
      setCursor(data.nextCursor);
    } catch {
      // keep existing items; surface nothing intrusive on load-more failure
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Activity className="mb-3 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-secondary/40">
          <Activity className="h-6 w-6 text-muted-foreground/50" />
        </div>
        <p className="text-sm font-medium text-foreground/70">No activity yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Member, file, and billing events will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <ol className="relative border-l border-border/70 pl-6">
        {items.map((item) => {
          const meta = ACTION_META[item.action] ?? {
            label: item.action,
            icon: Activity,
          };
          const Icon = meta.icon;
          const detail = metaLabel(item);
          return (
            <li key={item.id} className="mb-6 last:mb-0">
              <span className="absolute -left-[13px] flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card">
                <Icon className="h-3 w-3 text-muted-foreground" />
              </span>
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium text-foreground">
                  {meta.label}
                  {detail && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {detail}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(item.createdAt)}
                  {item.actorType !== "user" && ` · ${item.actorType}`}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {cursor && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Load more
          </button>
        </div>
      )}
    </div>
  );
}

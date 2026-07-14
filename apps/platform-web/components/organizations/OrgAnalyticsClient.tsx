"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { HardDrive, Users2, FolderOpen, Activity } from "lucide-react";
import { toast } from "sonner";
import { StorageChart } from "@/components/dashboard/StorageChart";
import {
  OrgPageHeader,
  OrgSectionCard,
  OrgStatTile,
  OrgLoading,
  OrgEmptyState,
} from "@/components/organizations/org-ui";
import { formatBytes } from "@/lib/utils";

interface BillingUsage {
  totalStorageBytes: number;
  storageLimitBytes: number | null;
  totalObjects: number;
  seats: number;
  seatsUsed: number;
}
interface ActivityItem { action: string }

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data as T;
}

export function OrgAnalyticsClient({ orgId }: { orgId: string }) {
  const [usage, setUsage] = useState<BillingUsage | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, a] = await Promise.all([
        readJson<{ usage: BillingUsage }>(await fetch(`/api/orgs/${orgId}/billing`)),
        readJson<{ items: ActivityItem[] }>(await fetch(`/api/orgs/${orgId}/activity?limit=50`)),
      ]);
      setUsage(b.usage);
      setActivity(a.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activityByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of activity) {
      const category = item.action.split(".")[0] || "other";
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }, [activity]);

  if (loading || !usage) return <OrgLoading />;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <OrgPageHeader title="Analytics" description="Storage, seats, and recent activity across the organization." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <OrgStatTile icon={HardDrive} label="Storage" value={formatBytes(usage.totalStorageBytes)} hint={usage.storageLimitBytes === null ? "Unlimited" : `of ${formatBytes(usage.storageLimitBytes)}`} />
        <OrgStatTile icon={FolderOpen} label="Files" value={usage.totalObjects} />
        <OrgStatTile icon={Users2} label="Seats used" value={`${usage.seatsUsed}/${usage.seats}`} />
        <OrgStatTile icon={Activity} label="Recent events" value={activity.length} hint="last 50" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <OrgSectionCard title="Storage" icon={HardDrive}>
          <StorageChart usedBytes={usage.totalStorageBytes} totalBytes={usage.storageLimitBytes} />
        </OrgSectionCard>

        <OrgSectionCard title="Activity by category" icon={Activity}>
          {activityByCategory.length === 0 ? (
            <OrgEmptyState icon={Activity} title="No activity yet" compact />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activityByCategory} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="category" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: "var(--accent)", opacity: 0.3 }}
                    content={({ active, payload, label }) =>
                      active && payload && payload.length ? (
                        <div className="rounded-lg border border-border bg-popover px-3 py-1.5 text-xs shadow-sm">
                          <span className="capitalize text-muted-foreground">{label}: </span>
                          <span className="font-medium text-foreground">{payload[0].value}</span>
                        </div>
                      ) : null
                    }
                  />
                  <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </OrgSectionCard>
      </div>
    </div>
  );
}

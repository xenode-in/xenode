"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Star,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  Archive,
  FileType,
  Clock,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
  OrgPageHeader,
  OrgLoading,
  OrgEmptyState,
} from "@/components/organizations/org-ui";
import { cn, formatBytes, formatDate } from "@/lib/utils";

type Scope = "recent" | "favorites" | "bin";

interface ObjectRow {
  id: string;
  size: number;
  contentType: string;
  mediaCategory: string;
  starred: boolean;
  createdAt: string | null;
}

const CATEGORY_ICON: Record<string, LucideIcon> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  archive: Archive,
  pdf: FileType,
  document: FileText,
};

const SCOPE_META: Record<Scope, { title: string; description: string; empty: string; icon: LucideIcon }> = {
  recent: {
    title: "Recent",
    description: "Recently added files across this organization.",
    empty: "No recent files yet.",
    icon: Clock,
  },
  favorites: {
    title: "Favorites",
    description: "Files you've starred in this organization.",
    empty: "Star files to find them here quickly.",
    icon: Star,
  },
  bin: {
    title: "Bin",
    description: "Deleted organization files awaiting purge.",
    empty: "The bin is empty.",
    icon: Trash2,
  },
};

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data as T;
}

export function OrgObjectList({ orgId, scope }: { orgId: string; scope: Scope }) {
  const meta = SCOPE_META[scope];
  const [rows, setRows] = useState<ObjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await readJson<{ objects: ObjectRow[] }>(
        await fetch(`/api/orgs/${orgId}/objects/browse?scope=${scope}`),
      );
      setRows(data.objects);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [orgId, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleStar(row: ObjectRow) {
    setBusy(row.id);
    const next = !row.starred;
    try {
      await readJson(
        await fetch(`/api/orgs/${orgId}/objects/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ starred: next }),
        }),
      );
      if (scope === "favorites" && !next) {
        setRows((prev) => prev.filter((r) => r.id !== row.id));
      } else {
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, starred: next } : r)));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <OrgLoading />;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <OrgPageHeader title={meta.title} description={meta.description} />

      {rows.length === 0 ? (
        <OrgEmptyState icon={meta.icon} title={meta.empty} />
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card">
          {rows.map((row) => {
            const Icon = CATEGORY_ICON[row.mediaCategory] ?? FileText;
            return (
              <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary/50 text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">Encrypted file</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(row.size)}
                    {row.createdAt && ` · ${formatDate(row.createdAt)}`}
                  </p>
                </div>
                {scope !== "bin" && (
                  <button
                    onClick={() => toggleStar(row)}
                    disabled={busy !== null}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    aria-label={row.starred ? "Unstar" : "Star"}
                  >
                    <Star
                      className={cn(
                        "h-4 w-4",
                        row.starred && "fill-primary text-primary",
                      )}
                    />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

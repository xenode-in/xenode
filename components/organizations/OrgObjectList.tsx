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
  Loader2,
  Lock,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
  OrgPageHeader,
  OrgLoading,
  OrgEmptyState,
} from "@/components/organizations/org-ui";
import { Button } from "@/components/ui/button";
import { useCrypto } from "@/contexts/CryptoContext";
import { unwrapSpaceKeyGrant } from "@/lib/orgs/spaceKeyClient";
import { decryptMetadataString } from "@/lib/crypto/fileEncryption";
import { cn, formatBytes, formatDate } from "@/lib/utils";

type Scope = "recent" | "favorites" | "bin";

interface ObjectRow {
  id: string;
  size: number;
  contentType: string;
  mediaCategory: string;
  starred: boolean;
  createdAt: string | null;
  isEncrypted: boolean;
  encryptedName: string | null;
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
    description: "Deleted organization files. Restore them or delete forever.",
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
  const { privateKey, isUnlocked, setModalOpen } = useCrypto();
  const [rows, setRows] = useState<ObjectRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [spaceKey, setSpaceKey] = useState<CryptoKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const isBin = scope === "bin";

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

  // Load the org space key so we can decrypt file names.
  useEffect(() => {
    if (!privateKey) {
      setSpaceKey(null);
      return;
    }
    let active = true;
    (async () => {
      try {
        const data = await readJson<{
          grants: { wrappedSpaceKey: string; keyVersion: number }[];
        }>(await fetch(`/api/orgs/${orgId}/keys`));
        const grant = data.grants?.[0];
        if (!grant?.wrappedSpaceKey) return;
        const raw = await unwrapSpaceKeyGrant({
          wrappedSpaceKey: grant.wrappedSpaceKey,
          privateKey,
        });
        const key = await crypto.subtle.importKey(
          "raw",
          raw.buffer.slice(
            raw.byteOffset,
            raw.byteOffset + raw.byteLength,
          ) as ArrayBuffer,
          { name: "AES-GCM" },
          false,
          ["decrypt"],
        );
        if (active) setSpaceKey(key);
      } catch {
        // Vault locked or key unavailable — names stay generic.
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, privateKey]);

  // Decrypt names once the space key is available.
  useEffect(() => {
    if (!spaceKey || rows.length === 0) return;
    let active = true;
    (async () => {
      const resolved: Record<string, string> = {};
      for (const row of rows) {
        if (!row.isEncrypted || !row.encryptedName) continue;
        try {
          resolved[row.id] = await decryptMetadataString(
            row.encryptedName,
            spaceKey,
          );
        } catch {
          /* leave generic */
        }
      }
      if (active) setNames((prev) => ({ ...prev, ...resolved }));
    })();
    return () => {
      active = false;
    };
  }, [rows, spaceKey]);

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

  async function restore(row: ObjectRow) {
    setBusy(row.id);
    try {
      await readJson(
        await fetch(`/api/orgs/${orgId}/objects/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [row.id] }),
        }),
      );
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success("File restored");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to restore");
    } finally {
      setBusy(null);
    }
  }

  async function purge(row: ObjectRow) {
    const label = names[row.id] || "this file";
    if (!window.confirm(`Permanently delete ${label}? This cannot be undone.`)) {
      return;
    }
    setBusy(row.id);
    try {
      await readJson(
        await fetch(`/api/orgs/${orgId}/objects/purge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [row.id] }),
        }),
      );
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success("File permanently deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete");
    } finally {
      setBusy(null);
    }
  }

  async function emptyBin() {
    if (!window.confirm("Permanently delete everything in the bin? This cannot be undone.")) {
      return;
    }
    setBusy("empty");
    try {
      await readJson(
        await fetch(`/api/orgs/${orgId}/objects/purge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ all: true }),
        }),
      );
      setRows([]);
      toast.success("Bin emptied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to empty bin");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <OrgLoading />;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <OrgPageHeader
        title={meta.title}
        description={meta.description}
        action={
          isBin && rows.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={emptyBin}
              disabled={busy !== null}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {busy === "empty" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Empty bin
            </Button>
          ) : undefined
        }
      />

      {!isUnlocked && rows.some((r) => r.isEncrypted) && (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex w-full items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4 text-left text-sm transition-colors hover:bg-primary/10"
        >
          <Lock className="h-4 w-4 text-primary" />
          Unlock your vault to see file names.
        </button>
      )}

      {rows.length === 0 ? (
        <OrgEmptyState icon={meta.icon} title={meta.empty} />
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card">
          {rows.map((row) => {
            const Icon = CATEGORY_ICON[row.mediaCategory] ?? FileText;
            const name = names[row.id] || "Encrypted file";
            return (
              <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary/50 text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(row.size)}
                    {row.createdAt && ` · ${formatDate(row.createdAt)}`}
                  </p>
                </div>
                {isBin ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => restore(row)}
                      disabled={busy !== null}
                      aria-label="Restore"
                    >
                      {busy === row.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => purge(row)}
                      disabled={busy !== null}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Delete forever"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
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

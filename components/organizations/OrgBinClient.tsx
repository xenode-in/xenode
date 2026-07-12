"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Trash2,
  RotateCcw,
  Loader2,
  AlertTriangle,
  Lock,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  Archive,
  FileType,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCrypto } from "@/contexts/CryptoContext";
import { unwrapSpaceKeyGrant } from "@/lib/orgs/spaceKeyClient";
import { decryptMetadataString } from "@/lib/crypto/fileEncryption";
import { formatBytes } from "@/lib/utils";

const RETENTION_DAYS = 30;

const CATEGORY_ICON: Record<string, LucideIcon> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  archive: Archive,
  pdf: FileType,
  document: FileText,
};

interface BinObject {
  id: string;
  size: number;
  contentType: string;
  mediaCategory: string;
  isEncrypted: boolean;
  encryptedName: string | null;
  deletedAt: string | null;
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data as T;
}

function daysLeft(deletedAt: string | null): number {
  if (!deletedAt) return RETENTION_DAYS;
  const purgeAt = new Date(deletedAt).getTime() + RETENTION_DAYS * 86_400_000;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / 86_400_000));
}

export function OrgBinClient({ orgId }: { orgId: string }) {
  const { privateKey, isUnlocked, setModalOpen } = useCrypto();
  const [items, setItems] = useState<BinObject[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [spaceKey, setSpaceKey] = useState<CryptoKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDeleteForever, setConfirmDeleteForever] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await readJson<{ objects: BinObject[] }>(
        await fetch(`/api/orgs/${orgId}/objects/browse?scope=bin`),
      );
      setItems(data.objects);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bin");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load the org space key to decrypt names.
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
          raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
          { name: "AES-GCM" },
          false,
          ["decrypt"],
        );
        if (active) setSpaceKey(key);
      } catch {
        /* vault locked — names stay generic */
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, privateKey]);

  useEffect(() => {
    if (!spaceKey || items.length === 0) return;
    let active = true;
    (async () => {
      const resolved: Record<string, string> = {};
      for (const item of items) {
        if (!item.isEncrypted || !item.encryptedName) continue;
        try {
          resolved[item.id] = await decryptMetadataString(item.encryptedName, spaceKey);
        } catch {
          /* keep generic */
        }
      }
      if (active) setNames((prev) => ({ ...prev, ...resolved }));
    })();
    return () => {
      active = false;
    };
  }, [items, spaceKey]);

  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const headerCheckboxState: boolean | "indeterminate" = useMemo(() => {
    if (items.length === 0) return false;
    if (allSelected) return true;
    return selected.size > 0 ? "indeterminate" : false;
  }, [items.length, allSelected, selected.size]);

  const dropFromList = (ids: Set<string>) => {
    setItems((prev) => prev.filter((i) => !ids.has(i.id)));
    setSelected(new Set());
  };

  async function handleRestore() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    setBusy(true);
    setError("");
    try {
      await readJson(
        await fetch(`/api/orgs/${orgId}/objects/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        }),
      );
      dropFromList(new Set(ids));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteForever() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    setBusy(true);
    setError("");
    try {
      await readJson(
        await fetch(`/api/orgs/${orgId}/objects/purge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        }),
      );
      dropFromList(new Set(ids));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
      setConfirmDeleteForever(false);
    }
  }

  async function handleEmptyBin() {
    setBusy(true);
    setError("");
    try {
      await readJson(
        await fetch(`/api/orgs/${orgId}/objects/purge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ all: true }),
        }),
      );
      setItems([]);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Empty bin failed");
    } finally {
      setBusy(false);
      setConfirmEmpty(false);
    }
  }

  const hasSelection = selected.size > 0;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Trash2 className="h-6 w-6" /> Bin
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Deleted items are kept for {RETENTION_DAYS} days, then permanently
            removed. They still count toward organization storage until purged.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasSelection && (
            <>
              <Button variant="outline" onClick={handleRestore} disabled={busy}>
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                Restore ({selected.size})
              </Button>
              <Button
                variant="destructive"
                onClick={() => setConfirmDeleteForever(true)}
                disabled={busy}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete forever
              </Button>
            </>
          )}
          {items.length > 0 && !hasSelection && (
            <Button
              variant="destructive"
              onClick={() => setConfirmEmpty(true)}
              disabled={busy}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Empty Bin
            </Button>
          )}
        </div>
      </div>

      {!isUnlocked && items.some((i) => i.isEncrypted) && (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex w-full items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4 text-left text-sm transition-colors hover:bg-primary/10"
        >
          <Lock className="h-4 w-4 text-primary" />
          Unlock your vault to see file names.
        </button>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
          <Trash2 className="h-10 w-10" />
          <p>The Bin is empty.</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table className="min-w-[640px] md:min-w-full">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    checked={headerCheckboxState}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Size</TableHead>
                <TableHead className="text-right">Deletes in</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const left = daysLeft(item.deletedAt);
                const Icon = CATEGORY_ICON[item.mediaCategory] ?? FileText;
                return (
                  <TableRow
                    key={item.id}
                    data-state={selected.has(item.id) ? "selected" : undefined}
                    className="cursor-pointer"
                    onClick={() => toggle(item.id)}
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(item.id)}
                        onCheckedChange={() => toggle(item.id)}
                        aria-label="Select row"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary/50 text-muted-foreground">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="max-w-[320px] truncate font-medium">
                          {names[item.id] || "Encrypted file"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatBytes(item.size)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {left === 0 ? "Soon" : `${left} day${left > 1 ? "s" : ""}`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={confirmDeleteForever} onOpenChange={setConfirmDeleteForever}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selected.size} item{selected.size > 1 ? "s" : ""} forever?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected items and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteForever();
              }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmEmpty} onOpenChange={setConfirmEmpty}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty Bin?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes everything in the Bin. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleEmptyBin();
              }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Empty Bin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

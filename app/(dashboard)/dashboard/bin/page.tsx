"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  Trash2,
  RotateCcw,
  Loader2,
  ImageOff,
  AlertTriangle,
  Folder,
} from "lucide-react";
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
import { useThumbnail } from "@/hooks/useThumbnail";
import { useIsVisible } from "@/hooks/useIsVisible";
import { decryptMetadataString } from "@/lib/crypto/fileEncryption";
import { formatBytes } from "@/lib/utils";

const RETENTION_DAYS = 30;

interface BinObject {
  _id: string;
  key: string;
  size: number;
  contentType: string;
  thumbnail?: string;
  thumbnailUrl?: string;
  encryptedName?: string;
  encryptedDisplayName?: string;
  deletedAt?: string;
  decryptedName?: string;
}

function daysLeft(deletedAt?: string): number {
  if (!deletedAt) return RETENTION_DAYS;
  const purgeAt = new Date(deletedAt).getTime() + RETENTION_DAYS * 86_400_000;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / 86_400_000));
}

function Thumb({ item }: { item: BinObject }) {
  const { metadataKey } = useCrypto();
  const [ref, isVisible] = useIsVisible();
  const url = useThumbnail(isVisible ? item.thumbnail : undefined, metadataKey);
  const isFolder = item.contentType === "application/x-directory" || item.key.endsWith("/");

  return (
    <div
      ref={ref}
      className="bg-muted flex h-10 w-10 items-center justify-center overflow-hidden rounded"
    >
      {isFolder ? (
        <Folder className="text-primary fill-primary/20 h-5 w-5" />
      ) : url ? (
        <Image
          src={url}
          alt=""
          width={40}
          height={40}
          unoptimized
          className="h-10 w-10 object-cover"
        />
      ) : (
        <ImageOff className="text-muted-foreground h-4 w-4" />
      )}
    </div>
  );
}

export default function BinPage() {
  const { metadataKey } = useCrypto();
  const [bucketId, setBucketId] = useState<string | null>(null);
  const [items, setItems] = useState<BinObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDeleteForever, setConfirmDeleteForever] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [error, setError] = useState("");

  // Resolve the user's root bucket, then load the bin.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/drive/config");
        if (!res.ok) throw new Error("Failed to load drive config");
        const data = await res.json();
        if (!cancelled) setBucketId(data.bucket._id);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load bin");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(
    async (bid: string) => {
      const res = await fetch(
        `/api/objects?bucketId=${bid}&deleted=true&fetchAll=true`,
      );
      if (!res.ok) throw new Error("Failed to load bin");
      const data = await res.json();
      const raw: BinObject[] = data.objects ?? [];
      const withNames = await Promise.all(
        raw.map(async (o) => {
          let decryptedName = "Encrypted file";
          const enc = o.encryptedDisplayName || o.encryptedName;
          if (enc && metadataKey) {
            try {
              decryptedName = await decryptMetadataString(enc, metadataKey);
            } catch {
              /* keep fallback */
            }
          }
          return { ...o, decryptedName };
        }),
      );
      setItems(withNames);
    },
    [metadataKey],
  );

  useEffect(() => {
    if (!bucketId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await load(bucketId);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load bin");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bucketId, load]);

  const filteredItems = useMemo(() => {
    const deletedFolderKeys = new Set(
      items
        .filter((o) => o.contentType === "application/x-directory" || o.key.endsWith("/"))
        .map((o) => o.key)
    );

    return items.filter((item) => {
      const parts = item.key.split("/");
      let runningPrefix = "";
      for (let i = 0; i < parts.length - 1; i++) {
        runningPrefix += parts[i] + "/";
        if (deletedFolderKeys.has(runningPrefix) && runningPrefix !== item.key) {
          return false;
        }
      }
      return true;
    });
  }, [items]);

  const allSelected = filteredItems.length > 0 && selected.size === filteredItems.length;
  const toggleAll = () =>
    setSelected(
      allSelected ? new Set() : new Set(filteredItems.map((i) => i._id)),
    );
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const dropFromList = (ids: Set<string>) => {
    setItems((prev) => prev.filter((i) => !ids.has(i._id)));
    setSelected(new Set());
  };

  const handleRestore = async () => {
    if (!bucketId || selected.size === 0) return;
    const ids = Array.from(selected);
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/objects/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucketId, ids }),
      });
      if (!res.ok) throw new Error("Restore failed");
      dropFromList(new Set(ids));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteForever = async () => {
    if (!bucketId || selected.size === 0) return;
    const ids = Array.from(selected);
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/objects/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucketId, ids }),
      });
      if (!res.ok) throw new Error("Delete failed");
      dropFromList(new Set(ids));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
      setConfirmDeleteForever(false);
    }
  };

  const handleEmptyBin = async () => {
    if (!bucketId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/objects/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucketId, all: true }),
      });
      if (!res.ok) throw new Error("Empty bin failed");
      setItems([]);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Empty bin failed");
    } finally {
      setBusy(false);
      setConfirmEmpty(false);
    }
  };

  const hasSelection = selected.size > 0;
  const headerCheckboxState: boolean | "indeterminate" = useMemo(() => {
    if (filteredItems.length === 0) return false;
    if (allSelected) return true;
    return selected.size > 0 ? "indeterminate" : false;
  }, [filteredItems.length, allSelected, selected.size]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Trash2 className="h-6 w-6" /> Bin
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Deleted items are kept for {RETENTION_DAYS} days, then permanently
            removed. They still count toward your storage until purged.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasSelection && (
            <>
              <Button
                variant="outline"
                onClick={handleRestore}
                disabled={busy}
              >
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
          {filteredItems.length > 0 && !hasSelection && (
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

      {error && (
        <div className="text-destructive flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-24">
          <Trash2 className="h-10 w-10" />
          <p>The Bin is empty.</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table className="min-w-[700px] md:min-w-full">
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
              {filteredItems.map((item) => {
                const left = daysLeft(item.deletedAt);
                const isFolder = item.contentType === "application/x-directory" || item.key.endsWith("/");
                return (
                  <TableRow
                    key={item._id}
                    data-state={selected.has(item._id) ? "selected" : undefined}
                    className="cursor-pointer"
                    onClick={() => toggle(item._id)}
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(item._id)}
                        onCheckedChange={() => toggle(item._id)}
                        aria-label="Select row"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Thumb item={item} />
                        <span className="max-w-[320px] truncate font-medium">
                          {item.decryptedName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {isFolder ? "-" : formatBytes(item.size)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right">
                      {left === 0 ? "Soon" : `${left} day${left > 1 ? "s" : ""}`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Delete forever confirmation */}
      <AlertDialog
        open={confirmDeleteForever}
        onOpenChange={setConfirmDeleteForever}
      >
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
                handleDeleteForever();
              }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Empty bin confirmation */}
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
                handleEmptyBin();
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

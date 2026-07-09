"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  History,
  RotateCcw,
  Trash2,
  Download,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useOptionalCrypto } from "@/contexts/CryptoContext";
import {
  decryptFileWithDEK,
  decryptFileChunkedCombined,
} from "@/lib/crypto/fileEncryption";
import { fromB64 } from "@/lib/crypto/utils";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";

interface VersionEntry {
  versionId: string;
  size: number;
  contentType: string | null;
  isEncrypted: boolean;
  createdAt: string;
  createdBy: string;
  encryptedDEK: string | null;
  iv: string | null;
  chunkSize: number | null;
  chunkCount: number | null;
  chunkIvs: string | null;
}

interface FileVersionsDialogProps {
  fileId: string;
  fileName: string;
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful restore so the parent can refresh its view. */
  onRestored?: () => void;
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function FileVersionsDialog({
  fileId,
  fileName,
  isOpen,
  onClose,
  onRestored,
}: FileVersionsDialogProps) {
  const crypto = useOptionalCrypto();
  const privateKey = crypto?.privateKey;
  const workspace = useOptionalWorkspace();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [maxVersions, setMaxVersions] = useState(10);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = workspace?.scopedFetch
        ? await workspace.scopedFetch(`/api/objects/${fileId}/versions`)
        : await fetch(`/api/objects/${fileId}/versions`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load versions");
      }
      const data = await res.json();
      setVersions(data.versions ?? []);
      setMaxVersions(data.maxVersions ?? 10);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load versions");
    } finally {
      setLoading(false);
    }
  }, [fileId, workspace]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const handleRestore = async (versionId: string) => {
    setBusyId(versionId);
    try {
      const res = workspace?.scopedFetch
        ? await workspace.scopedFetch(
            `/api/objects/${fileId}/versions/${versionId}/restore`,
            { method: "POST" },
          )
        : await fetch(
            `/api/objects/${fileId}/versions/${versionId}/restore`,
            { method: "POST" },
          );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Restore failed");
      }
      toast.success("Version restored");
      await load();
      onRestored?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (versionId: string) => {
    if (!window.confirm("Permanently delete this version? This cannot be undone."))
      return;
    setBusyId(versionId);
    try {
      const res = workspace?.scopedFetch
        ? await workspace.scopedFetch(
            `/api/objects/${fileId}/versions/${versionId}`,
            { method: "DELETE" },
          )
        : await fetch(
            `/api/objects/${fileId}/versions/${versionId}`,
            { method: "DELETE" },
          );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Delete failed");
      }
      toast.success("Version deleted");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleDownload = async (v: VersionEntry) => {
    setBusyId(v.versionId);
    try {
      const res = workspace?.scopedFetch
        ? await workspace.scopedFetch(
            `/api/objects/${fileId}/content?version=${v.versionId}`,
          )
        : await fetch(
            `/api/objects/${fileId}/content?version=${v.versionId}`,
          );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch version");
      }
      const cipher = await res.arrayBuffer();
      const type = v.contentType || "application/octet-stream";

      let blob: Blob;
      if (v.isEncrypted) {
        if (!privateKey) throw new Error("Unlock your vault to download this version");
        if (!v.encryptedDEK) throw new Error("Missing decryption key for version");
        const rawDEK = await window.crypto.subtle.decrypt(
          { name: "RSA-OAEP" },
          privateKey,
          fromB64(v.encryptedDEK),
        );
        const dek = await window.crypto.subtle.importKey(
          "raw",
          rawDEK,
          { name: "AES-GCM", length: 256 },
          false,
          ["decrypt"],
        );
        if (v.chunkIvs && v.chunkSize && v.chunkCount) {
          blob = await decryptFileChunkedCombined(
            cipher,
            null,
            v.chunkIvs,
            v.chunkSize,
            v.chunkCount,
            dek,
            type,
          );
        } else {
          blob = await decryptFileWithDEK(cipher, dek, v.iv ?? "", type);
        }
      } else {
        blob = new Blob([cipher], { type });
      }

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> Version history
          </DialogTitle>
          <DialogDescription className="truncate">
            {fileName} · keeps the last {maxVersions} versions
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertCircle className="h-7 w-7 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : versions.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-10 text-center text-muted-foreground">
            <History className="h-7 w-7" />
            <p className="text-sm">No previous versions yet.</p>
            <p className="text-xs">
              Older copies appear here when this file is overwritten.
            </p>
          </div>
        ) : (
          <ul className="max-h-[60vh] divide-y overflow-y-auto">
            {versions.map((v, idx) => (
              <li
                key={v.versionId}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    Version {versions.length - idx}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString()} ·{" "}
                    {formatBytes(v.size)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Download this version"
                    disabled={busyId === v.versionId}
                    onClick={() => void handleDownload(v)}
                  >
                    {busyId === v.versionId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Restore this version"
                    disabled={busyId === v.versionId}
                    onClick={() => void handleRestore(v.versionId)}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    title="Delete this version"
                    disabled={busyId === v.versionId}
                    onClick={() => void handleDelete(v.versionId)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

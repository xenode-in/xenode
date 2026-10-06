"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  unwrapSpaceFileKey,
  unwrapUserFileKey,
} from "@/lib/crypto/fileEncryption";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { useWorkspaceSpaceKey } from "@/lib/orgs/useWorkspaceSpaceKey";
import { downloadCiphertextBlob } from "@/lib/crypto/direct-download";
import { REVISION_HEADER } from "@/lib/storage/revisions";

interface VersionEntry {
  versionId: string;
  isOriginal?: boolean;
  size: number;
  contentType: string | null;
  isEncrypted: boolean;
  createdAt: string;
  createdBy: string;
  encryptedDEK: string | null;
  wrappedBy?: "user" | "space" | null;
  spaceKeyVersion?: number | null;
  spaceKeyWrapIv?: string | null;
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
  const workspaceSpaceKey = useWorkspaceSpaceKey();

  const [busyId, setBusyId] = useState<string | null>(null);
  const { data, isFetching: loading, error: queryError, refetch: load } = useQuery({
    queryKey: ["file-versions", fileId, workspace?.driveScope ?? "personal"],
    enabled: isOpen,
    queryFn: async ({ signal }) => {
      const res = workspace?.scopedFetch
        ? await workspace.scopedFetch(`/api/objects/${fileId}/versions`, { signal })
        : await fetch(`/api/objects/${fileId}/versions`, { signal });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load versions");
      }
      return await res.json() as {
        versions: VersionEntry[];
        maxVersions: number;
        revision: number;
        spaceId: string;
      };
    },
  });
  const versions = data?.versions ?? [];
  const maxVersions = data?.maxVersions ?? 10;
  const revision = data?.revision ?? 0;
  const error = queryError instanceof Error ? queryError.message : "";

  const handleRestore = async (versionId: string) => {
    setBusyId(versionId);
    try {
      const res = workspace?.scopedFetch
        ? await workspace.scopedFetch(
            `/api/objects/${fileId}/versions/${versionId}/restore`,
            { method: "POST", headers: { [REVISION_HEADER]: String(revision) } },
          )
        : await fetch(
            `/api/objects/${fileId}/versions/${versionId}/restore`,
            { method: "POST", headers: { [REVISION_HEADER]: String(revision) } },
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
      toast.success("Version scheduled for deletion");
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
      const urls = await res.json();
      const type = v.contentType || "application/octet-stream";

      // Every version of a file is bound to the same object id.
      if (!v.encryptedDEK || !data) throw new Error("Missing decryption key for version");
      let dek: CryptoKey;
      if (v.wrappedBy === "space") {
        const rawKey = await workspaceSpaceKey.rawKeyFor(v.spaceKeyVersion);
        if (!rawKey || !v.spaceKeyWrapIv || !v.spaceKeyVersion) {
          throw new Error("Unlock the organization workspace key first");
        }
        dek = await unwrapSpaceFileKey(v.encryptedDEK, v.spaceKeyWrapIv, rawKey, {
          fileId,
          spaceId: data.spaceId,
          spaceKeyVersion: v.spaceKeyVersion,
        });
      } else {
        if (!privateKey) throw new Error("Unlock your vault to download this version");
        dek = await unwrapUserFileKey(v.encryptedDEK, privateKey, fileId);
      }
      const blob = await downloadCiphertextBlob(
        urls,
        dek,
        v.chunkIvs ? { chunkIvs: v.chunkIvs, chunkSize: v.chunkSize } : { iv: v.iv },
        fileId,
        type,
      );

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
                    {v.isOriginal ? "Original" : "Version " + (versions.length - idx)}
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
                  {!v.isOriginal && (
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
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

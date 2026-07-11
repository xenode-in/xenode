"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Download,
  Eye,
  FileText,
  FolderOpen,
  Inbox,
  Link2,
  Loader2,
  Lock,
  MessageSquare,
  Share2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  OrgPageHeader,
  OrgLoading,
  OrgEmptyState,
} from "@/components/organizations/org-ui";
import { FilePreviewDialog } from "@/components/dashboard/FilePreviewDialog";
import { FileCommentsDialog } from "@/components/FileCommentsDialog";
import { useCrypto } from "@/contexts/CryptoContext";
import { decryptWithShareKey } from "@/lib/crypto/fileEncryption";
import { buildShareKey, fetchShareBlob } from "@/lib/crypto/directShare";
import { normalizeShareRole, type ShareRole } from "@/lib/orgs/shareRoles";
import { formatBytes, formatDate } from "@/lib/utils";

// ─── "Shared" scope (admin view of what's shared out of the org) ──────────────

interface ShareRow {
  id: string;
  objectId: string;
  type: "link" | "direct";
  isBundle?: boolean;
  bundleName?: string | null;
  itemCount?: number | null;
  createdBy: string | null;
  recipientCount?: number | null;
  accessType?: string;
  createdAt: string | null;
}

// ─── "With me" scope (files shared to the caller) ─────────────────────────────

interface WithMeRow {
  id: string;
  type: "direct";
  role: ShareRole;
  createdAt: string | null;
  owner: { name: string | null; email: string | null } | null;
  wrappedShareKey: string | null;
  shareEncryptedName: string | null;
  shareEncryptedContentType: string | null;
  shareEncryptedDEK: string | null;
  shareKeyIv: string | null;
  object: {
    id: string;
    key: string;
    size: number;
    contentType: string;
    isEncrypted: boolean;
    mediaCategory: string | null;
  } | null;
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data as T;
}

const ROLE_LABEL: Record<ShareRole, string> = {
  viewer: "Viewer",
  commenter: "Commenter",
  editor: "Editor",
};

function fallbackName(row: WithMeRow): string {
  return row.object?.key.split("/").pop() || "Encrypted file";
}

export function OrgSharesClient({
  orgId,
  scope,
}: {
  orgId: string;
  scope: "shared" | "with-me";
}) {
  if (scope === "with-me") {
    return <SharedWithMe orgId={orgId} />;
  }
  return <SharedOut orgId={orgId} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared With Me — functional: decrypt name, preview, download.
// ─────────────────────────────────────────────────────────────────────────────

function SharedWithMe({ orgId }: { orgId: string }) {
  const { isUnlocked, privateKey, setModalOpen } = useCrypto();
  const [rows, setRows] = useState<WithMeRow[]>([]);
  const [names, setNames] = useState<Record<string, { name: string; contentType: string }>>({});
  const [loading, setLoading] = useState(true);
  const [restricted, setRestricted] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<WithMeRow | null>(null);
  const [commentRow, setCommentRow] = useState<WithMeRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/shares?scope=with-me`);
      if (res.status === 403) {
        setRestricted(true);
        return;
      }
      const data = await readJson<{ shares: WithMeRow[] }>(res);
      setRows(data.shares);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load shares");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Decrypt file names once the vault is unlocked.
  useEffect(() => {
    if (!privateKey || rows.length === 0) return;
    let active = true;
    (async () => {
      const resolved: Record<string, { name: string; contentType: string }> = {};
      for (const row of rows) {
        if (!row.object?.isEncrypted || !row.shareEncryptedName || !row.wrappedShareKey) {
          resolved[row.id] = {
            name: fallbackName(row),
            contentType: row.object?.contentType || "application/octet-stream",
          };
          continue;
        }
        try {
          const shareKey = await buildShareKey(row.wrappedShareKey, privateKey);
          const name = await decryptWithShareKey(row.shareEncryptedName, shareKey);
          const contentType = row.shareEncryptedContentType
            ? await decryptWithShareKey(row.shareEncryptedContentType, shareKey)
            : row.object?.contentType || "application/octet-stream";
          resolved[row.id] = { name, contentType };
        } catch {
          resolved[row.id] = {
            name: fallbackName(row),
            contentType: row.object?.contentType || "application/octet-stream",
          };
        }
      }
      if (active) setNames(resolved);
    })();
    return () => {
      active = false;
    };
  }, [rows, privateKey]);

  const download = async (row: WithMeRow) => {
    if (!row.object) return;
    if (row.object.isEncrypted && !isUnlocked) {
      setModalOpen(true);
      return;
    }
    setBusyId(row.id);
    try {
      const resolved = names[row.id];
      const blob = await fetchShareBlob({
        shareId: row.id,
        mode: "download",
        isEncrypted: row.object.isEncrypted,
        wrappedShareKey: row.wrappedShareKey ?? undefined,
        shareEncryptedDEK: row.shareEncryptedDEK ?? undefined,
        shareKeyIv: row.shareKeyIv ?? undefined,
        privateKey,
        contentType: resolved?.contentType,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = resolved?.name || fallbackName(row);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Download failed");
    } finally {
      setBusyId(null);
    }
  };

  const openPreview = (row: WithMeRow) => {
    if (row.object?.isEncrypted && !isUnlocked) {
      setModalOpen(true);
      return;
    }
    setPreview(row);
  };

  if (loading) return <OrgLoading />;

  const previewName = preview ? names[preview.id]?.name || fallbackName(preview) : "";
  const previewFile =
    preview && preview.object
      ? {
          id: preview.object.id,
          key: preview.object.key,
          size: preview.object.size,
          contentType:
            names[preview.id]?.contentType || preview.object.contentType,
          createdAt: preview.createdAt || new Date().toISOString(),
          isEncrypted: preview.object.isEncrypted,
          encryptedName: undefined,
          name: previewName,
          mediaCategory: preview.object.mediaCategory ?? undefined,
        }
      : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <OrgPageHeader
        title="Shared With Me"
        description="Organization files explicitly shared with you."
      />

      {!isUnlocked && rows.length > 0 && (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex w-full items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4 text-left text-sm transition-colors hover:bg-primary/10"
        >
          <Lock className="h-4 w-4 text-primary" />
          Unlock your vault to preview and download shared files.
        </button>
      )}

      {restricted ? (
        <OrgEmptyState
          icon={Share2}
          title="Limited access"
          description="Sharing isn't available for your role."
        />
      ) : rows.length === 0 ? (
        <OrgEmptyState
          icon={Inbox}
          title="Nothing shared with you yet"
          description="Files an admin or teammate shares with you will appear here."
        />
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card">
          {rows.map((row) => {
            const name = names[row.id]?.name || fallbackName(row);
            return (
              <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary/50 text-muted-foreground">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.owner?.name || row.owner?.email || "A teammate"}
                    {row.object ? ` · ${formatBytes(row.object.size)}` : ""}
                    {row.createdAt ? ` · ${formatDate(row.createdAt)}` : ""}
                  </p>
                </div>
                <Badge variant="secondary">{ROLE_LABEL[row.role]}</Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCommentRow(row)}
                  aria-label="Comments"
                >
                  <MessageSquare className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openPreview(row)}
                  aria-label="Preview"
                >
                  <Eye className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => download(row)}
                  disabled={busyId === row.id}
                  aria-label="Download"
                >
                  {busyId === row.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <FilePreviewDialog
        file={previewFile}
        isOpen={!!preview}
        onClose={() => setPreview(null)}
        directShareId={preview?.id}
        directShareWrappedKey={preview?.wrappedShareKey ?? undefined}
        onDownload={preview ? () => download(preview) : undefined}
      />

      <FileCommentsDialog
        shareId={commentRow?.id ?? null}
        wrappedShareKey={commentRow?.wrappedShareKey ?? null}
        fileName={commentRow ? names[commentRow.id]?.name : undefined}
        open={!!commentRow}
        onOpenChange={(next) => {
          if (!next) setCommentRow(null);
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared (out of the org) — unchanged metadata list for admins.
// ─────────────────────────────────────────────────────────────────────────────

function SharedOut({ orgId }: { orgId: string }) {
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [restricted, setRestricted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/shares?scope=shared`);
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
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <OrgLoading />;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <OrgPageHeader
        title="Shared"
        description="Organization files shared via links or direct shares."
      />

      {restricted ? (
        <OrgEmptyState
          icon={Share2}
          title="Limited access"
          description="Sharing isn't available for your role."
        />
      ) : shares.length === 0 ? (
        <OrgEmptyState
          icon={Share2}
          title="Nothing shared yet"
          description="Share links and direct shares of org files will appear here."
        />
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card">
          {shares.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary/50 text-muted-foreground">
                {s.isBundle ? (
                  <FolderOpen className="h-4 w-4" />
                ) : s.type === "link" ? (
                  <Link2 className="h-4 w-4" />
                ) : (
                  <Users className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {s.isBundle
                    ? s.bundleName || `${s.itemCount || 0} shared files`
                    : "Encrypted file"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {s.isBundle
                    ? `Bundle${typeof s.itemCount === "number" ? ` · ${s.itemCount} file${s.itemCount === 1 ? "" : "s"}` : ""}`
                    : s.type === "link"
                      ? "Public link"
                      : "Direct share"}
                  {typeof s.recipientCount === "number" &&
                    ` · ${s.recipientCount} recipient${s.recipientCount === 1 ? "" : "s"}`}
                  {s.createdAt && ` · ${formatDate(s.createdAt)}`}
                </p>
              </div>
              {s.accessType && (
                <Badge variant="secondary" className="capitalize">
                  {ROLE_LABEL[normalizeShareRole(s.accessType)]}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

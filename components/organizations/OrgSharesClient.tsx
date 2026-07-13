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
  Table2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  OrgPageHeader,
  OrgLoading,
  OrgEmptyState,
} from "@/components/organizations/org-ui";
import { FilePreviewDialog } from "@/components/dashboard/FilePreviewDialog";
import { FileCommentsDialog } from "@/components/FileCommentsDialog";
import { WorkspaceScopeProvider } from "@/contexts/WorkspaceContext";
import { ShareAccessRequestButton } from "@/components/ShareAccessRequestButton";
import { ShareAccessRequestsInbox } from "@/components/ShareAccessRequestsInbox";
import { useCrypto } from "@/contexts/CryptoContext";
import {
  decryptMetadataString,
  decryptWithShareKey,
} from "@/lib/crypto/fileEncryption";
import { buildShareKey, fetchShareBlob } from "@/lib/crypto/directShare";
import { unwrapSpaceKeyGrant } from "@/lib/orgs/spaceKeyClient";
import { type ShareRole } from "@/lib/orgs/shareRoles";
import { formatBytes, formatDate } from "@/lib/utils";

// ─── "Shared" scope (admin view of what's shared out of the org) ──────────────

interface ShareRow {
  id: string;
  objectId: string;
  type: "link" | "direct";
  isBundle?: boolean;
  bundleName?: string | null;
  itemCount?: number | null;
  token?: string | null;
  createdBy: string | null;
  recipientCount?: number | null;
  recipientEmails?: string[];
  object?: {
    id: string;
    encryptedName: string | null;
    encryptedContentType: string | null;
    isEncrypted: boolean;
    mediaCategory: string | null;
    size: number;
    contentType: string;
    key: string;
    bucketId: string | null;
  } | null;
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
  return (
    // Org scope so the preview dialog gets org scopedFetch + the space key
    // (admins preview the underlying org object, not the share payload).
    <WorkspaceScopeProvider driveScope={{ type: "organization", orgId }}>
      <SharedOut orgId={orgId} />
    </WorkspaceScopeProvider>
  );
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

  // Clicking the file itself behaves like the normal file list: spreadsheets
  // open in the (permission-aware) editor, everything else opens the preview.
  const openRow = (row: WithMeRow) => {
    if (row.object?.isEncrypted && !isUnlocked) {
      setModalOpen(true);
      return;
    }
    if (row.object?.mediaCategory === "excel") {
      window.location.assign(`/sheets/editor?shareId=${row.id}`);
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
                <button
                  type="button"
                  onClick={() => openRow(row)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left transition-colors hover:bg-secondary/30"
                >
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
                </button>
                <Badge variant="secondary">{ROLE_LABEL[row.role]}</Badge>
                <ShareAccessRequestButton shareId={row.id} currentRole={row.role} />
                {row.object?.mediaCategory === "excel" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (row.object?.isEncrypted && !isUnlocked) {
                        setModalOpen(true);
                        return;
                      }
                      window.location.assign(`/sheets/editor?shareId=${row.id}`);
                    }}
                    aria-label="Open in Xenode Sheets"
                    title="Open in Xenode Sheets"
                  >
                    <Table2 className="h-4 w-4" />
                  </Button>
                )}
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
        objectId={commentRow?.object?.id ?? null}
        wrappedShareKey={commentRow?.wrappedShareKey ?? null}
        shareEncryptedDEK={commentRow?.shareEncryptedDEK ?? null}
        shareKeyIv={commentRow?.shareKeyIv ?? null}
        canComment={commentRow ? commentRow.role !== "viewer" : false}
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
  const { privateKey, isUnlocked, setModalOpen } = useCrypto();
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [types, setTypes] = useState<Record<string, string>>({});
  const [spaceKey, setSpaceKey] = useState<CryptoKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [restricted, setRestricted] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ShareRow | null>(null);

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

  // Load the org space key to decrypt file names.
  useEffect(() => {
    if (!privateKey) return;
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
        /* names stay generic */
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, privateKey]);

  useEffect(() => {
    if (!spaceKey || shares.length === 0) return;
    let active = true;
    (async () => {
      const resolved: Record<string, string> = {};
      const resolvedTypes: Record<string, string> = {};
      for (const s of shares) {
        if (s.isBundle || !s.object?.isEncrypted) continue;
        if (s.object.encryptedName) {
          try {
            resolved[s.id] = await decryptMetadataString(s.object.encryptedName, spaceKey);
          } catch {
            /* keep generic */
          }
        }
        if (s.object.encryptedContentType) {
          try {
            resolvedTypes[s.id] = await decryptMetadataString(s.object.encryptedContentType, spaceKey);
          } catch {
            /* keep generic */
          }
        }
      }
      if (active) {
        setNames((prev) => ({ ...prev, ...resolved }));
        setTypes((prev) => ({ ...prev, ...resolvedTypes }));
      }
    })();
    return () => {
      active = false;
    };
  }, [shares, spaceKey]);

  const openPreview = (s: ShareRow) => {
    if (s.object?.isEncrypted && !isUnlocked) {
      setModalOpen(true);
      return;
    }
    setPreview(s);
  };

  async function revoke(s: ShareRow) {
    if (!window.confirm("Revoke this share? Recipients will lose access.")) return;
    setBusyId(s.id);
    try {
      const endpoint =
        s.type === "link" && s.token
          ? `/api/share/${s.token}`
          : `/api/direct-shares/${s.id}`;
      await readJson(await fetch(endpoint, { method: "DELETE" }));
      setShares((prev) => prev.filter((r) => r.id !== s.id));
      toast.success("Share revoked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to revoke");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <OrgLoading />;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <OrgPageHeader
        title="Shared"
        description="Organization files shared via links or direct shares."
      />

      <ShareAccessRequestsInbox onDecided={load} />

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
        <div className="rounded-lg border">
          <Table className="min-w-[640px] md:min-w-full">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>File</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Shared with</TableHead>
                <TableHead className="hidden md:table-cell">Created</TableHead>
                <TableHead className="w-16 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shares.map((s) => {
                const displayName = s.isBundle
                  ? s.bundleName || `${s.itemCount || 0} shared files`
                  : names[s.id] || "Encrypted file";
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary/50 text-muted-foreground">
                          {s.isBundle ? (
                            <FolderOpen className="h-4 w-4" />
                          ) : s.type === "link" ? (
                            <Link2 className="h-4 w-4" />
                          ) : (
                            <FileText className="h-4 w-4" />
                          )}
                        </span>
                        <span className="max-w-[260px] truncate font-medium">
                          {displayName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {s.type === "link" ? "Public link" : "Direct share"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {s.type === "link" ? (
                        <span className="text-xs text-muted-foreground">Anyone with link</span>
                      ) : s.recipientEmails && s.recipientEmails.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {s.recipientEmails.slice(0, 2).map((email) => (
                            <Badge key={email} variant="outline" className="text-[10px]">
                              {email}
                            </Badge>
                          ))}
                          {s.recipientEmails.length > 2 && (
                            <Badge variant="outline" className="text-[10px]">
                              +{s.recipientEmails.length - 2}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {s.recipientCount ?? 0} recipient
                          {s.recipientCount === 1 ? "" : "s"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {s.createdAt ? formatDate(s.createdAt) : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        {!s.isBundle && s.object && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openPreview(s)}
                            aria-label="Preview file"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => revoke(s)}
                          disabled={busyId === s.id}
                          aria-label="Revoke share"
                        >
                          {busyId === s.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <FilePreviewDialog
        file={
          preview?.object
            ? {
                id: preview.object.id,
                key: preview.object.key,
                size: preview.object.size,
                contentType:
                  types[preview.id] ||
                  preview.object.contentType ||
                  "application/octet-stream",
                createdAt: preview.createdAt || new Date().toISOString(),
                isEncrypted: preview.object.isEncrypted,
                encryptedName: undefined,
                name: names[preview.id] || "Encrypted file",
                mediaCategory: preview.object.mediaCategory ?? undefined,
                bucketId: preview.object.bucketId ?? undefined,
              }
            : null
        }
        isOpen={!!preview}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}

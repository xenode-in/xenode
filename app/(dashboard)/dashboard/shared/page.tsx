"use client";

import { useEffect, useState } from "react";
import { formatBytes } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Loader2,
  Trash2,
  Share2,
  AlertCircle,
  Copy,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import { useCrypto } from "@/contexts/CryptoContext";
import { decryptMetadataString } from "@/lib/crypto/fileEncryption";

interface PublicShare {
  _id: string;
  token: string;
  objectId: {
    _id: string;
    key: string;
    size: number;
    isEncrypted?: boolean;
    encryptedName?: string;
  };
  expiresAt?: string;
  downloadCount: number;
  maxDownloads?: number;
  isPasswordProtected: boolean;
  sharedWith: string[];
  createdAt: string;
}

interface DirectShare {
  _id: string;
  objectId: {
    _id: string;
    key: string;
    size: number;
    isEncrypted?: boolean;
    encryptedName?: string;
  };
  recipients: Array<{
    recipientEmail: string;
    downloadCount: number;
  }>;
  createdAt: string;
}

type ShareRow = {
  id: string;
  type: "public" | "direct";
  objectId: PublicShare["objectId"];
  createdAt: string;
  expiresAt?: string;
  downloadCount: number;
  maxDownloads?: number;
  isPasswordProtected: boolean;
  sharedWith: string[];
  token?: string;
};

export default function SharedPage() {
  const [rows, setRows] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>(
    {},
  );
  const { isUnlocked, metadataKey } = useCrypto();

  useEffect(() => {
    const fetchShares = async () => {
      try {
        const [publicRes, directRes] = await Promise.all([
          fetch("/api/share"),
          fetch("/api/direct-shares"),
        ]);

        const publicData = await publicRes.json();
        const directData = await directRes.json();

        if (!publicRes.ok) {
          throw new Error(publicData.error || "Failed to load public shares");
        }
        if (!directRes.ok) {
          throw new Error(directData.error || "Failed to load direct shares");
        }

        const publicRows: ShareRow[] = (publicData.shareLinks || []).map(
          (link: PublicShare) => ({
            id: link._id,
            type: "public",
            objectId: link.objectId,
            createdAt: link.createdAt,
            expiresAt: link.expiresAt,
            downloadCount: link.downloadCount,
            maxDownloads: link.maxDownloads,
            isPasswordProtected: link.isPasswordProtected,
            sharedWith: link.sharedWith || [],
            token: link.token,
          }),
        );

        const directRows: ShareRow[] = (directData.directShares || []).map(
          (share: DirectShare) => ({
            id: share._id,
            type: "direct",
            objectId: share.objectId,
            createdAt: share.createdAt,
            downloadCount: (share.recipients || []).reduce(
              (sum, recipient) => sum + (recipient.downloadCount || 0),
              0,
            ),
            isPasswordProtected: false,
            sharedWith: (share.recipients || []).map(
              (recipient) => recipient.recipientEmail,
            ),
          }),
        );

        setRows(
          [...directRows, ...publicRows].sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          ),
        );
      } catch (fetchError) {
        setError(
          fetchError instanceof Error ? fetchError.message : "Failed to load shares",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchShares();
  }, []);

  useEffect(() => {
    if (!isUnlocked || !metadataKey) {
      setDecryptedNames({});
      return;
    }

    const run = async () => {
      const nextNames: Record<string, string> = {};
      for (const row of rows) {
        if (row.objectId.isEncrypted && row.objectId.encryptedName) {
          try {
            nextNames[row.id] = await decryptMetadataString(
              row.objectId.encryptedName,
              metadataKey,
            );
          } catch (decryptError) {
            console.error("Failed to decrypt file name", decryptError);
          }
        }
      }
      setDecryptedNames(nextNames);
    };

    run();
  }, [rows, isUnlocked, metadataKey]);

  const revokeShare = async (row: ShareRow) => {
    const message =
      row.type === "public"
        ? "Are you sure you want to revoke this public link?"
        : "Are you sure you want to revoke this direct share?";

    if (!confirm(message)) return;

    setRevokingId(row.id);
    try {
      const endpoint =
        row.type === "public" && row.token
          ? `/api/share/${row.token}`
          : `/api/direct-shares/${row.id}`;

      const res = await fetch(endpoint, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to revoke share");

      setRows((current) => current.filter((item) => item.id !== row.id));
      toast.success(
        row.type === "public"
          ? "Public link revoked"
          : "Direct share revoked",
      );
    } catch (revokeError) {
      toast.error(
        revokeError instanceof Error ? revokeError.message : "Failed to revoke share",
      );
    } finally {
      setRevokingId(null);
    }
  };

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/shared/${token}`);
    toast.success("Link copied to clipboard");
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center text-destructive">
        <AlertCircle className="mr-2 h-5 w-5" />
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Shared by me</h1>
        <p className="text-muted-foreground">
          Manage public links and direct shares you created
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center mt-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-4">
            <Share2 className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-lg font-medium">No shared files</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            You have not shared any files yet.
          </p>
        </div>
      ) : (
        <div className="rounded-md border bg-card text-card-foreground shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>File</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Downloads</TableHead>
                <TableHead>Shared With</TableHead>
                <TableHead>Security</TableHead>
                <TableHead className="hidden md:table-cell">Expires</TableHead>
                <TableHead className="w-[120px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const isExpired =
                  row.expiresAt && new Date(row.expiresAt) < new Date();
                const displayName =
                  decryptedNames[row.id] ||
                  row.objectId.key.split("/").pop() ||
                  row.objectId.key;

                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="flex flex-col overflow-hidden">
                          <span className="truncate font-medium">
                            {displayName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatBytes(row.objectId.size)} •{" "}
                            {new Date(row.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {row.type === "direct" ? "Direct Share" : "Public Link"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {row.downloadCount}
                        {row.maxDownloads ? ` / ${row.maxDownloads}` : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.sharedWith.length > 0 ? (
                          row.sharedWith.slice(0, 2).map((email) => (
                            <Badge
                              key={`${row.id}-${email}`}
                              variant="secondary"
                              className="text-[10px]"
                            >
                              {email}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Public
                          </span>
                        )}
                        {row.sharedWith.length > 2 && (
                          <Badge variant="secondary" className="text-[10px]">
                            +{row.sharedWith.length - 2} more
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {row.isPasswordProtected && (
                          <Badge
                            variant="outline"
                            className="text-amber-500 border-amber-500/20 bg-amber-500/10 px-1 py-0 h-5"
                          >
                            <Lock className="h-3 w-3 mr-1" /> Pass
                          </Badge>
                        )}
                        {row.objectId.isEncrypted && (
                          <Badge
                            variant="outline"
                            className="text-green-500 border-green-500/20 bg-green-500/10 px-1 py-0 h-5"
                          >
                            E2EE
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {row.expiresAt ? (
                        <span
                          className={`text-sm ${isExpired ? "text-destructive" : ""}`}
                        >
                          {new Date(row.expiresAt).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {row.type === "public" && row.token && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => copyLink(row.token!)}
                            disabled={!!isExpired}
                            title="Copy Link"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => revokeShare(row)}
                          disabled={revokingId === row.id}
                          title="Revoke Share"
                        >
                          {revokingId === row.id ? (
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
    </div>
  );
}

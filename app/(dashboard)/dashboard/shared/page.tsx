"use client";

import { useState, useEffect } from "react";
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
  Check,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import { useCrypto } from "@/contexts/CryptoContext";
import { decryptFileName, decryptMetadataString } from "@/lib/crypto/fileEncryption";

interface RawShareLink {
  _id: string;
  token: string;
  objectId: {
    _id: string;
    key: string;
    size: number;
    contentType: string;
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

export default function SharedPage() {
  const [links, setLinks] = useState<RawShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>({});
  const { isUnlocked, metadataKey } = useCrypto();

  const fetchLinks = async () => {
    try {
      const res = await fetch("/api/share");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch links");
      setLinks(data.shareLinks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load links");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLinks();
  }, []);

  useEffect(() => {
    if (!isUnlocked) {
      setDecryptedNames({});
      return;
    }

    const decryptNames = async () => {
      const newNames: Record<string, string> = {};
      for (const link of links) {
        if (link.objectId.isEncrypted && link.objectId.encryptedName && metadataKey) {
          try {
            const name = await decryptMetadataString(link.objectId.encryptedName, metadataKey);
            newNames[link._id] = name;
          } catch (e) {
            console.error("Failed to decrypt name", e);
          }
        }
      }
      setDecryptedNames((prev) => ({ ...prev, ...newNames }));
    };

    decryptNames();
  }, [links, isUnlocked]);

  const revokeLink = async (token: string, id: string) => {
    if (
      !confirm(
        "Are you sure you want to revoke this link? Anyone with the link will lose access.",
      )
    )
      return;
    setRevokingId(id);
    try {
      const res = await fetch(`/api/share/${token}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to revoke link");
      }
      toast.success("Link revoked successfully");
      setLinks(links.filter((l) => l._id !== id));
    } catch (err) {
      toast.error("Error revoking link", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setRevokingId(null);
    }
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/shared/${token}`;
    navigator.clipboard.writeText(url);
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
          Manage files you have shared with others
        </p>
      </div>

      {links.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center mt-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-4">
            <Share2 className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-lg font-medium">No shared files</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            You haven&apos;t shared any files yet. To share a file, go to your
            files and click the share icon.
          </p>
        </div>
      ) : (
        <div className="rounded-md border bg-card text-card-foreground shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>File</TableHead>
                <TableHead>Downloads</TableHead>
                <TableHead>Shared With</TableHead>
                <TableHead>Security</TableHead>
                <TableHead className="hidden md:table-cell">Expires</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((link) => {
                const isExpired =
                  link.expiresAt && new Date(link.expiresAt) < new Date();
                const displayName =
                  decryptedNames[link._id] ||
                  link.objectId.encryptedName ||
                  link.objectId.key.split("/").pop() ||
                  link.objectId.key;

                return (
                  <TableRow key={link._id}>
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
                            {formatBytes(link.objectId.size)} •{" "}
                            {new Date(link.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {link.downloadCount}{" "}
                        {link.maxDownloads ? `/ ${link.maxDownloads}` : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {link.sharedWith && link.sharedWith.length > 0 ? (
                          link.sharedWith.slice(0, 2).map((email) => (
                            <Badge
                              key={email}
                              variant="secondary"
                              className="text-[10px]"
                            >
                              {email}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Public Link
                          </span>
                        )}
                        {link.sharedWith && link.sharedWith.length > 2 && (
                          <Badge variant="secondary" className="text-[10px]">
                            +{link.sharedWith.length - 2} more
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {link.isPasswordProtected && (
                          <Badge
                            variant="outline"
                            className="text-amber-500 border-amber-500/20 bg-amber-500/10 hover:bg-amber-500/20 px-1 py-0 h-5"
                          >
                            <Lock className="h-3 w-3 mr-1" /> Pass
                          </Badge>
                        )}
                        {link.objectId.isEncrypted && (
                          <Badge
                            variant="outline"
                            className="text-green-500 border-green-500/20 bg-green-500/10 hover:bg-green-500/20 px-1 py-0 h-5"
                          >
                            E2EE
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {link.expiresAt ? (
                        <span
                          className={`text-sm ${isExpired ? "text-destructive" : ""}`}
                        >
                          {new Date(link.expiresAt).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => copyLink(link.token)}
                          disabled={!!isExpired}
                          title="Copy Link"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => revokeLink(link.token, link._id)}
                          disabled={revokingId === link._id}
                          title="Revoke Share"
                        >
                          {revokingId === link._id ? (
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

"use client";

import { useCallback, useEffect, useState } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertCircle,
  Copy,
  Edit3,
  FileText,
  Loader2,
  Lock,
  Share2,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { useCrypto } from "@/contexts/CryptoContext";
import {
  decryptMetadataString,
  encryptWithShareKey,
} from "@/lib/crypto/fileEncryption";
import { fromB64 } from "@/lib/crypto/utils";

interface SharedObject {
  _id: string;
  key: string;
  size: number;
  contentType?: string;
  isEncrypted?: boolean;
  encryptedName?: string;
  encryptedContentType?: string;
  mediaCategory?: string;
}

interface PublicShare {
  _id: string;
  token: string;
  objectId: SharedObject;
  expiresAt?: string;
  downloadCount: number;
  maxDownloads?: number;
  isPasswordProtected: boolean;
  sharedWith: string[];
  createdAt: string;
}

interface DirectRecipient {
  recipientUserId: string;
  recipientEmail: string;
  wrappedShareKey: string;
  accessType: "view" | "download";
  downloadCount: number;
  lastAccessedAt?: string;
}

interface DirectShare {
  _id: string;
  objectId: SharedObject;
  recipients: DirectRecipient[];
  createdAt: string;
}

type ShareRow = {
  id: string;
  type: "public" | "direct";
  objectId: SharedObject;
  createdAt: string;
  expiresAt?: string;
  downloadCount: number;
  maxDownloads?: number;
  isPasswordProtected: boolean;
  sharedWith: string[];
  recipients?: DirectRecipient[];
  token?: string;
};

interface ObjectKeyPackage {
  encryptedDEK?: string;
  encryptedName?: string;
  encryptedContentType?: string;
  error?: string;
}

interface RecipientLookup {
  userId: string;
  email: string;
  publicKey: string;
}

function bytesToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes));
}

function bytesToB64url(bytes: Uint8Array): string {
  return bytesToB64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function parseEmails(input: string) {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export default function SharedPage() {
  const [rows, setRows] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editRow, setEditRow] = useState<ShareRow | null>(null);
  const [usersRow, setUsersRow] = useState<ShareRow | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [maxDownloads, setMaxDownloads] = useState("");
  const [sharedWithInput, setSharedWithInput] = useState("");
  const [accessType, setAccessType] = useState<"view" | "download">(
    "download",
  );
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>(
    {},
  );
  const { isUnlocked, metadataKey, privateKey, setModalOpen } = useCrypto();

  const fetchShares = useCallback(async () => {
    try {
      setError(null);
      const [publicRes, directRes] = await Promise.all([
        fetch("/api/share"),
        fetch("/api/direct-shares"),
      ]);

      const publicData = await publicRes.json();
      const directData = await directRes.json();

      if (!publicRes.ok)
        throw new Error(publicData.error || "Failed to load public shares");
      if (!directRes.ok)
        throw new Error(directData.error || "Failed to load direct shares");

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
          recipients: share.recipients || [],
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
  }, []);

  useEffect(() => {
    fetchShares();
  }, [fetchShares]);

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

  async function getOwnerDekBytes(fileId: string) {
    if (!privateKey) {
      setModalOpen(true);
      throw new Error("Unlock your vault to update encrypted sharing");
    }

    const res = await fetch(`/api/objects/${fileId}`);
    const data = (await res.json()) as ObjectKeyPackage;
    if (!res.ok) throw new Error(data.error || "Failed to load file keys");
    if (!data.encryptedDEK) throw new Error("Missing file encryption key");

    const raw = await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      privateKey,
      fromB64(data.encryptedDEK),
    );

    return {
      dekBytes: new Uint8Array(raw),
      encryptedName: data.encryptedName,
      encryptedContentType: data.encryptedContentType,
    };
  }

  async function buildShareKeyPackage(row: ShareRow) {
    const { dekBytes, encryptedName, encryptedContentType } =
      await getOwnerDekBytes(row.objectId._id);
    const shareKeyRaw = crypto.getRandomValues(new Uint8Array(32));
    const shareKeyObj = await crypto.subtle.importKey(
      "raw",
      shareKeyRaw.buffer.slice(
        shareKeyRaw.byteOffset,
        shareKeyRaw.byteOffset + shareKeyRaw.byteLength,
      ) as ArrayBuffer,
      { name: "AES-GCM" },
      false,
      ["wrapKey", "encrypt", "decrypt"],
    );
    const dekKey = await crypto.subtle.importKey(
      "raw",
      dekBytes.buffer.slice(
        dekBytes.byteOffset,
        dekBytes.byteOffset + dekBytes.byteLength,
      ) as ArrayBuffer,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"],
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.wrapKey("raw", dekKey, shareKeyObj, {
      name: "AES-GCM",
      iv,
    });

    const packageData: Record<string, string> = {
      shareEncryptedDEK: bytesToB64(wrapped),
      shareKeyIv: bytesToB64(iv),
    };

    if (metadataKey && encryptedName) {
      const name = await decryptMetadataString(encryptedName, metadataKey);
      packageData.shareEncryptedName = await encryptWithShareKey(
        name,
        shareKeyObj,
      );
    }

    if (metadataKey && encryptedContentType) {
      const type = await decryptMetadataString(encryptedContentType, metadataKey);
      packageData.shareEncryptedContentType = await encryptWithShareKey(
        type,
        shareKeyObj,
      );
    }

    return { packageData, shareKeyRaw, shareKeyObj };
  }

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
        row.type === "public" ? "Public link revoked" : "Direct share revoked",
      );
    } catch (revokeError) {
      toast.error(
        revokeError instanceof Error ? revokeError.message : "Failed to revoke share",
      );
    } finally {
      setRevokingId(null);
    }
  };

  const copyLink = async (row: ShareRow) => {
    if (row.type !== "public" || !row.token) return;

    setCopyingId(row.id);
    try {
      let url = `${window.location.origin}/shared/${row.token}`;

      if (row.objectId.isEncrypted) {
        const { packageData, shareKeyRaw } = await buildShareKeyPackage(row);
        const res = await fetch(`/api/share/${row.token}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(packageData),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to refresh link key");
        url += `#${bytesToB64url(shareKeyRaw)}`;
        await fetchShares();
      }

      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } catch (copyError) {
      toast.error(
        copyError instanceof Error ? copyError.message : "Failed to copy link",
      );
    } finally {
      setCopyingId(null);
    }
  };

  const openEdit = (row: ShareRow) => {
    setEditRow(row);
    setExpiresAt(
      row.expiresAt ? new Date(row.expiresAt).toISOString().slice(0, 16) : "",
    );
    setMaxDownloads(row.maxDownloads ? String(row.maxDownloads) : "");
    setSharedWithInput(row.sharedWith.join(", "));
    setAccessType(row.recipients?.[0]?.accessType || "download");
  };

  const saveEdit = async () => {
    if (!editRow) return;

    setSaving(true);
    try {
      const endpoint =
        editRow.type === "public" && editRow.token
          ? `/api/share/${editRow.token}`
          : `/api/direct-shares/${editRow.id}`;
      const body =
        editRow.type === "public"
          ? {
              expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
              maxDownloads: maxDownloads ? Number(maxDownloads) : null,
              sharedWith: parseEmails(sharedWithInput),
            }
          : {
              recipients: (editRow.recipients || []).map((recipient) => ({
                ...recipient,
                accessType,
              })),
            };

      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update share");

      setEditRow(null);
      await fetchShares();
      toast.success("Share updated");
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : "Failed to update share",
      );
    } finally {
      setSaving(false);
    }
  };

  const openUsers = (row: ShareRow) => {
    setUsersRow(row);
    setSharedWithInput(row.sharedWith.join(", "));
    setAccessType(row.recipients?.[0]?.accessType || "download");
  };

  const saveUsers = async () => {
    if (!usersRow) return;

    const emails = parseEmails(sharedWithInput);
    if (emails.length === 0) {
      toast.error("Add at least one recipient or revoke the share");
      return;
    }

    setSaving(true);
    try {
      if (usersRow.type === "public") {
        if (!usersRow.token) throw new Error("Missing share token");
        const res = await fetch(`/api/share/${usersRow.token}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sharedWith: emails }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to update users");
      } else {
        const lookupRes = await fetch("/api/direct-shares/recipients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails }),
        });
        const lookupData = await lookupRes.json();
        if (!lookupRes.ok) throw new Error(lookupData.error || "Lookup failed");
        if (lookupData.unavailable?.length) {
          throw new Error(
            lookupData.unavailable
              .map(
                (item: { email: string; reason: string }) =>
                  `${item.email}: ${item.reason}`,
              )
              .join(" | "),
          );
        }

        let packageData: Record<string, string> = {};
        let shareKeyRaw: Uint8Array | null = null;
        if (usersRow.objectId.isEncrypted) {
          const built = await buildShareKeyPackage(usersRow);
          packageData = built.packageData;
          shareKeyRaw = built.shareKeyRaw;
        }

        const recipients = await Promise.all(
          (lookupData.recipients as RecipientLookup[]).map(
            async (recipient) => {
              let wrappedShareKey = "";
              if (usersRow.objectId.isEncrypted && shareKeyRaw) {
                const recipientPublicKey = await crypto.subtle.importKey(
                  "spki",
                  fromB64(recipient.publicKey).buffer as ArrayBuffer,
                  { name: "RSA-OAEP", hash: "SHA-256" },
                  false,
                  ["encrypt"],
                );
                const wrapped = await crypto.subtle.encrypt(
                  { name: "RSA-OAEP" },
                  recipientPublicKey,
                  shareKeyRaw.buffer.slice(
                    shareKeyRaw.byteOffset,
                    shareKeyRaw.byteOffset + shareKeyRaw.byteLength,
                  ) as ArrayBuffer,
                );
                wrappedShareKey = bytesToB64(wrapped);
              }

              return {
                recipientUserId: recipient.userId,
                recipientEmail: recipient.email,
                wrappedShareKey,
                accessType,
              };
            },
          ),
        );

        const res = await fetch(`/api/direct-shares/${usersRow.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipients, ...packageData }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to update users");
      }

      setUsersRow(null);
      await fetchShares();
      toast.success("Users updated");
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : "Failed to update users",
      );
    } finally {
      setSaving(false);
    }
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
                <TableHead className="w-[170px] text-right">Actions</TableHead>
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
                            {formatBytes(row.objectId.size)} -{" "}
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
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {row.type === "public" && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => copyLink(row)}
                            disabled={!!isExpired || copyingId === row.id}
                            title="Copy link"
                          >
                            {copyingId === row.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(row)}
                          title="Edit share"
                        >
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openUsers(row)}
                          title="Manage users"
                        >
                          <UserPlus className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => revokeShare(row)}
                          disabled={revokingId === row.id}
                          title="Revoke share"
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

      <Dialog open={!!editRow} onOpenChange={(open) => !open && setEditRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit share</DialogTitle>
            <DialogDescription>
              Update limits and access behavior for this share.
            </DialogDescription>
          </DialogHeader>
          {editRow?.type === "public" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="expiresAt">Expires at</Label>
                <Input
                  id="expiresAt"
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxDownloads">Max downloads</Label>
                <Input
                  id="maxDownloads"
                  type="number"
                  min={1}
                  placeholder="No limit"
                  value={maxDownloads}
                  onChange={(event) => setMaxDownloads(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="publicSharedWith">Shared with</Label>
                <Textarea
                  id="publicSharedWith"
                  value={sharedWithInput}
                  onChange={(event) => setSharedWithInput(event.target.value)}
                  placeholder="email@example.com, another@example.com"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Recipient access</Label>
              <Select
                value={accessType}
                onValueChange={(value) =>
                  setAccessType(value === "view" ? "view" : "download")
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="download">Can download</SelectItem>
                  <SelectItem value="view">View only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!usersRow}
        onOpenChange={(open) => !open && setUsersRow(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage users</DialogTitle>
            <DialogDescription>
              Add or remove email addresses. Direct encrypted shares rotate the
              share key when recipients change.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sharedWith">Emails</Label>
              <Textarea
                id="sharedWith"
                value={sharedWithInput}
                onChange={(event) => setSharedWithInput(event.target.value)}
                placeholder="email@example.com, another@example.com"
              />
            </div>
            {usersRow?.type === "direct" && (
              <div className="space-y-2">
                <Label>Access</Label>
                <Select
                  value={accessType}
                  onValueChange={(value) =>
                    setAccessType(value === "view" ? "view" : "download")
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="download">Can download</SelectItem>
                    <SelectItem value="view">View only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUsersRow(null)}>
              Cancel
            </Button>
            <Button onClick={saveUsers} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save users
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

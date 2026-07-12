"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Copy,
  Check,
  Link2,
  Lock,
  Clock,
  RotateCcw,
  Loader2,
  AlertCircle,
  Users,
  FolderOpen,
} from "lucide-react";
import { toast } from "sonner";
import { useCrypto } from "@/contexts/CryptoContext";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import {
  decryptMetadataString,
  encryptWithShareKey,
} from "@/lib/crypto/fileEncryption";
import { fromB64 } from "@/lib/crypto/utils";
import { encryptShareKeyForOwner } from "@/lib/crypto/shareKey";
import { normalizeShareRole, type ShareRole } from "@/lib/orgs/shareRoles";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ShareableFile {
  id: string;
  key: string;
  size: number;
  contentType: string;
  isEncrypted?: boolean;
  encryptedName?: string;
  encryptedDisplayName?: string;
  encryptedContentType?: string;
  thumbnail?: string;
}

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  file: ShareableFile | null;
  files?: ShareableFile[];
  getDEKBytes?: (fileId: string) => Promise<Uint8Array>;
}

interface RecipientLookup {
  userId: string;
  email: string;
  publicKey: string;
}

interface OrgMemberSuggestion {
  userId: string;
  role: string;
  user: {
    email: string | null;
    name: string | null;
    image?: string | null;
  } | null;
}

function bytesToB64(buf: ArrayBuffer | Uint8Array): string {
  return btoa(
    String.fromCharCode(
      ...new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer),
    ),
  );
}

function bytesToB64url(bytes: Uint8Array): string {
  return bytesToB64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function ShareDialog({
  open,
  onOpenChange,
  file,
  files,
  getDEKBytes,
}: ShareDialogProps) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [directShareSummary, setDirectShareSummary] = useState<string | null>(
    null,
  );
  const { metadataKey, publicKey } = useCrypto();
  const workspace = useOptionalWorkspace();
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState("never");
  const [maxDl, setMaxDl] = useState("");
  const [usePass, setUsePass] = useState(false);
  const [pass, setPass] = useState("");
  const [bundleName, setBundleName] = useState("");
  const [sharedWithInput, setSharedWithInput] = useState("");
  const [shareRole, setShareRole] = useState<ShareRole>("viewer");
  const [orgMembers, setOrgMembers] = useState<OrgMemberSuggestion[]>([]);
  const [orgMembersLoading, setOrgMembersLoading] = useState(false);

  const driveScope = workspace?.driveScope;
  const orgId =
    driveScope?.type === "organization" || driveScope?.type === "team"
      ? driveScope.orgId
      : null;

  useEffect(() => {
    if (!open || !orgId) {
      setOrgMembers([]);
      return;
    }

    let cancelled = false;
    setOrgMembersLoading(true);
    fetch(`/api/orgs/${orgId}/members`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load members");
        if (!cancelled) setOrgMembers(data.members || []);
      })
      .catch(() => {
        if (!cancelled) setOrgMembers([]);
      })
      .finally(() => {
        if (!cancelled) setOrgMembersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, orgId]);

  const completedRecipientEmails = useMemo(() => {
    const parts = sharedWithInput
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    const completedParts =
      last && !last.includes("@") ? parts.slice(0, -1) : parts;
    return completedParts;
  }, [sharedWithInput]);

  const selectedRecipientEmails = useMemo(
    () => new Set(completedRecipientEmails),
    [completedRecipientEmails],
  );

  const orgMemberQuery = sharedWithInput
    .split(",")
    .pop()
    ?.trim()
    .toLowerCase() || "";

  const orgMemberSuggestions = useMemo(() => {
    if (!orgId) return [];
    const candidates = orgMembers.filter((member) => {
      const email = member.user?.email?.toLowerCase();
      if (!email || selectedRecipientEmails.has(email)) return false;
      if (!orgMemberQuery) return true;
      const name = member.user?.name?.toLowerCase() || "";
      return email.includes(orgMemberQuery) || name.includes(orgMemberQuery);
    });
    return candidates.slice(0, 6);
  }, [orgId, orgMembers, orgMemberQuery, selectedRecipientEmails]);

  function addOrgRecipient(email: string) {
    const normalized = email.trim().toLowerCase();
    if (!normalized || selectedRecipientEmails.has(normalized)) return;
    const parts = sharedWithInput
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    const emails =
      last && !last.includes("@") ? parts.slice(0, -1) : parts;
    setSharedWithInput([...emails, normalized].join(", "));
  }

  async function create() {
    const shareFiles = files?.length ? files : file ? [file] : [];
    if (shareFiles.length === 0) return;

    const primaryFile = shareFiles[0];
    const isBundle = shareFiles.length > 1;

    setCreating(true);
    setError(null);

    try {
      const recipientEmails = Array.from(
        new Set(
          sharedWithInput
            .split(",")
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean),
        ),
      );

      if (recipientEmails.length > 0 && isBundle) {
        throw new Error(
          "Direct email sharing supports one file at a time. Leave emails empty to create a multi-file link.",
        );
      }

      let shareEncryptedDEK: string | undefined;
      let shareKeyIv: string | undefined;
      let shareEncryptedName: string | undefined;
      let shareEncryptedContentType: string | undefined;
      let shareEncryptedThumbnail: string | undefined;
      let ownerEncryptedShareKey: string | undefined;
      let fragment: string | undefined;
      let shareKeyRaw: Uint8Array | undefined;
      let shareKeyObj: CryptoKey | undefined;

      const body: Record<string, unknown> = {
        objectId: primaryFile.id,
        accessType: "download",
        ...(expiresIn !== "never" && { expiresIn: parseInt(expiresIn, 10) }),
        ...(maxDl && { maxDownloads: parseInt(maxDl, 10) }),
        ...(usePass && pass && { password: pass }),
      };

      if (isBundle) {
        body.bundleName =
          bundleName.trim() || `${shareFiles.length} shared files`;
      }

      const hasEncryptedFiles = shareFiles.some((item) => item.isEncrypted);
      if (hasEncryptedFiles) {
        if (!getDEKBytes) {
          throw new Error("Encrypted file sharing is not available");
        }
        if (!publicKey) {
          throw new Error("Unlock your vault before creating encrypted links");
        }

        shareKeyRaw = crypto.getRandomValues(new Uint8Array(32));
        shareKeyObj = await crypto.subtle.importKey(
          "raw",
          shareKeyRaw.buffer.slice(
            shareKeyRaw.byteOffset,
            shareKeyRaw.byteOffset + shareKeyRaw.byteLength,
          ) as ArrayBuffer,
          { name: "AES-GCM" },
          false,
          ["wrapKey", "encrypt", "decrypt"],
        );

        const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
        const token = bytesToB64url(tokenBytes);
        fragment = bytesToB64url(shareKeyRaw);
        ownerEncryptedShareKey = await encryptShareKeyForOwner(
          shareKeyRaw,
          publicKey,
        );
        (body as { token?: string }).token = token;
        body.ownerEncryptedShareKey = ownerEncryptedShareKey;
      }

      async function buildShareItem(targetFile: ShareableFile) {
        if (!targetFile.isEncrypted) {
          return { objectId: targetFile.id };
        }
        if (!shareKeyObj || !getDEKBytes) {
          throw new Error("Missing encrypted share key package");
        }

        const dekBytes = await getDEKBytes(targetFile.id);
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
        const wrapped = await crypto.subtle.wrapKey(
          "raw",
          dekKey,
          shareKeyObj,
          { name: "AES-GCM", iv },
        );

        let itemShareEncryptedName: string | undefined;
        let itemShareEncryptedContentType: string | undefined;
        let itemShareEncryptedThumbnail: string | undefined;

        if (metadataKey) {
          const nameToDecrypt =
            targetFile.encryptedDisplayName || targetFile.encryptedName;
          if (nameToDecrypt) {
            const plaintextName = await decryptMetadataString(
              nameToDecrypt,
              metadataKey,
            );
            itemShareEncryptedName = await encryptWithShareKey(
              plaintextName,
              shareKeyObj,
            );
          }

          if (targetFile.encryptedContentType) {
            const plaintextType = await decryptMetadataString(
              targetFile.encryptedContentType,
              metadataKey,
            );
            itemShareEncryptedContentType = await encryptWithShareKey(
              plaintextType,
              shareKeyObj,
            );
          }

          if (targetFile.thumbnail && targetFile.thumbnail.startsWith("enc:")) {
            const { decryptThumbnail } =
              await import("@/lib/crypto/fileEncryption");
            const plaintextThumb = await decryptThumbnail(
              targetFile.thumbnail,
              metadataKey,
            );
            const encryptedThumb = await encryptWithShareKey(
              plaintextThumb,
              shareKeyObj,
            );

            try {
              const configRes = workspace?.scopedFetch
                ? await workspace.scopedFetch("/api/drive/config")
                : await fetch("/api/drive/config");
              const config = await configRes.json();
              const token = (body as { token?: string }).token;
              if (config.bucket && token) {
                const thumbName = isBundle
                  ? `${token}-${targetFile.id}-thumb`
                  : `${token}-thumb`;
                const presignRes = workspace?.scopedFetch
                  ? await workspace.scopedFetch("/api/objects/presign-upload", {
                      method: "POST",
                      body: JSON.stringify({
                        bucketId: config.bucket._id,
                        prefix: "shares/",
                        fileName: thumbName,
                        fileType: "application/octet-stream",
                        fileSize: encryptedThumb.length,
                      }),
                    })
                  : await fetch("/api/objects/presign-upload", {
                      method: "POST",
                      body: JSON.stringify({
                        bucketId: config.bucket._id,
                        prefix: "shares/",
                        fileName: thumbName,
                        fileType: "application/octet-stream",
                        fileSize: encryptedThumb.length,
                      }),
                    });
                const { uploadUrl, objectKey } = await presignRes.json();

                await fetch(uploadUrl, {
                  method: "PUT",
                  body: encryptedThumb,
                  headers: { "Content-Type": "application/octet-stream" },
                });

                itemShareEncryptedThumbnail = objectKey;
              }
            } catch (thumbnailError) {
              console.error(
                "Failed to upload shared thumbnail to B2",
                thumbnailError,
              );
            }
          }
        }

        return {
          objectId: targetFile.id,
          shareEncryptedDEK: bytesToB64(wrapped),
          shareKeyIv: bytesToB64(iv),
          shareEncryptedName: itemShareEncryptedName,
          shareEncryptedContentType: itemShareEncryptedContentType,
          shareEncryptedThumbnail: itemShareEncryptedThumbnail,
        };
      }

      if (isBundle) {
        body.items = await Promise.all(shareFiles.map(buildShareItem));
      } else if (primaryFile.isEncrypted) {
        const onlyItem = await buildShareItem(primaryFile);
        shareEncryptedDEK = onlyItem.shareEncryptedDEK;
        shareKeyIv = onlyItem.shareKeyIv;
        shareEncryptedName = onlyItem.shareEncryptedName;
        shareEncryptedContentType = onlyItem.shareEncryptedContentType;
        shareEncryptedThumbnail = onlyItem.shareEncryptedThumbnail;
        if (shareEncryptedDEK) body.shareEncryptedDEK = shareEncryptedDEK;
        if (shareKeyIv) body.shareKeyIv = shareKeyIv;
        if (shareEncryptedName) body.shareEncryptedName = shareEncryptedName;
        if (shareEncryptedContentType) {
          body.shareEncryptedContentType = shareEncryptedContentType;
        }
        if (shareEncryptedThumbnail) {
          body.shareEncryptedThumbnail = shareEncryptedThumbnail;
        }
      }

      if (recipientEmails.length > 0) {
        const scopedOrPlainFetch = (input: string, init?: RequestInit) =>
          workspace?.scopedFetch
            ? workspace.scopedFetch(input, init)
            : fetch(input, init);

        async function lookupRecipients(emails: string[]) {
          const lookupRes = await scopedOrPlainFetch(
            "/api/direct-shares/recipients",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ emails }),
            },
          );
          const lookupData = await lookupRes.json();
          if (!lookupRes.ok) throw new Error(lookupData.error);

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

          return lookupData.recipients as RecipientLookup[];
        }

        async function wrapShareKeyForRecipient(recipient: RecipientLookup) {
          if (!primaryFile.isEncrypted) return "";
          if (!shareKeyRaw) {
            throw new Error("Missing encrypted share key package");
          }

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
          return bytesToB64(wrapped);
        }

        interface ExistingShareRecipient {
          recipientUserId: string;
          recipientEmail: string;
          accessType?: string;
          downloadCount?: number;
          lastAccessedAt?: string | null;
        }

        // Drive-style merge: re-sharing updates the existing share instead of
        // creating a duplicate. Rotates the key package (same DEK) for the
        // union of old + new recipients.
        async function mergeIntoExistingShare(existing: {
          id: string;
          recipients: ExistingShareRecipient[];
        }) {
          const emailRoles = new Map<string, string>();
          const carryOver = new Map<string, ExistingShareRecipient>();
          for (const prior of existing.recipients) {
            const email = String(prior.recipientEmail).toLowerCase();
            emailRoles.set(email, normalizeShareRole(prior.accessType));
            carryOver.set(email, prior);
          }
          for (const email of recipientEmails) {
            emailRoles.set(email.toLowerCase(), shareRole);
          }

          const lookups = await lookupRecipients([...emailRoles.keys()]);
          const recipients = await Promise.all(
            lookups.map(async (recipient) => {
              const email = recipient.email.toLowerCase();
              const prior = carryOver.get(email);
              return {
                recipientUserId: recipient.userId,
                recipientEmail: recipient.email,
                wrappedShareKey: await wrapShareKeyForRecipient(recipient),
                accessType: emailRoles.get(email) ?? shareRole,
                downloadCount: prior?.downloadCount ?? 0,
                lastAccessedAt: prior?.lastAccessedAt ?? undefined,
              };
            }),
          );

          const patchBody: Record<string, unknown> = { recipients };
          if (primaryFile.isEncrypted) {
            patchBody.shareEncryptedDEK = shareEncryptedDEK;
            patchBody.shareKeyIv = shareKeyIv;
            patchBody.shareEncryptedName = shareEncryptedName;
            patchBody.shareEncryptedContentType = shareEncryptedContentType;
            patchBody.shareEncryptedThumbnail = shareEncryptedThumbnail;
          }

          const patchRes = await scopedOrPlainFetch(
            `/api/direct-shares/${existing.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patchBody),
            },
          );
          const patchData = await patchRes.json();
          if (!patchRes.ok) throw new Error(patchData.error);

          setShareUrl(null);
          setDirectShareSummary(
            `Updated share — now ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}.`,
          );
          toast.success("Share updated");
        }

        const existingRes = await scopedOrPlainFetch(
          `/api/direct-shares?objectId=${primaryFile.id}`,
        );
        if (existingRes.ok) {
          const existingData = await existingRes.json();
          const newest = Array.isArray(existingData.directShares)
            ? existingData.directShares[0]
            : null;
          if (newest) {
            await mergeIntoExistingShare({
              id: String(newest._id),
              recipients: (newest.recipients ??
                []) as ExistingShareRecipient[],
            });
            return;
          }
        }

        const lookups = await lookupRecipients(recipientEmails);
        const recipients = await Promise.all(
          lookups.map(async (recipient) => ({
            recipientUserId: recipient.userId,
            recipientEmail: recipient.email,
            wrappedShareKey: await wrapShareKeyForRecipient(recipient),
            accessType: shareRole,
          })),
        );

        const directShareRes = await scopedOrPlainFetch("/api/direct-shares", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objectId: primaryFile.id,
            shareEncryptedDEK,
            shareKeyIv,
            shareEncryptedName,
            shareEncryptedContentType,
            shareEncryptedThumbnail,
            recipients,
          }),
        });
        const directShareData = await directShareRes.json();
        if (!directShareRes.ok) {
          if (directShareData.code === "share_exists") {
            // Race fallback: another request created the share since our pre-check.
            await mergeIntoExistingShare({
              id: String(directShareData.directShareId),
              recipients: (directShareData.recipients ??
                []) as ExistingShareRecipient[],
            });
            return;
          }
          throw new Error(directShareData.error);
        }

        setShareUrl(null);
        setDirectShareSummary(
          `Shared securely with ${directShareData.recipientCount} recipient${directShareData.recipientCount === 1 ? "" : "s"}.`,
        );
        toast.success("Direct share created");
        return;
      }

      const res = workspace?.scopedFetch
        ? await workspace.scopedFetch("/api/share", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/share", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setDirectShareSummary(null);
      setShareUrl(
        fragment ? `${data.shareUrl}#key=${fragment}` : data.shareUrl,
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create share");
    } finally {
      setCreating(false);
    }
  }

  function copy() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function reset() {
    setShareUrl(null);
    setDirectShareSummary(null);
    setCopied(false);
    setError(null);
    setExpiresIn("never");
    setMaxDl("");
    setUsePass(false);
    setPass("");
    setBundleName("");
    setSharedWithInput("");
  }

  const shareFiles = files?.length ? files : file ? [file] : [];
  const isBundle = shareFiles.length > 1;
  const hasEncryptedShareFiles = shareFiles.some((item) => item.isEncrypted);
  const displayName = isBundle
    ? `${shareFiles.length} files selected`
    : file?.key.split("/").pop() ?? file?.key ?? "";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md bg-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isBundle ? (
              <FolderOpen className="h-4 w-4 text-primary" />
            ) : (
              <Link2 className="h-4 w-4 text-primary" />
            )}
            {isBundle ? "Share Files" : "Share File"}
          </DialogTitle>
          <DialogDescription className="break-all text-xs text-muted-foreground">
            {displayName}
            {isBundle && (
              <span className="ml-2 text-primary font-medium">
                bundled link
              </span>
            )}
            {!isBundle && file?.isEncrypted && (
              <span className="ml-2 text-green-500 font-medium">
                • E2E Encrypted
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {shareUrl || directShareSummary ? (
          <div className="space-y-4">
            {shareUrl ? (
              <div className="rounded-lg bg-secondary/40 border border-border p-3 space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Share Link
                </p>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={shareUrl}
                    className="h-8 font-mono text-[11px] bg-secondary/50 border-border"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 shrink-0 border-border"
                    onClick={copy}
                  >
                    {copied ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-secondary/40 border border-border p-3 text-sm">
                {directShareSummary}
              </div>
            )}

            {shareUrl && hasEncryptedShareFiles && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-400">
                The decryption key is embedded in the URL fragment. Share this
                link only with people you trust.
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 border-border"
                onClick={reset}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> New Share
              </Button>
              <Button
                size="sm"
                className="flex-1 bg-primary hover:bg-primary/90"
                onClick={copy}
                disabled={!shareUrl}
              >
                {copied ? (
                  <>
                    <Check className="mr-1.5 h-3.5 w-3.5" /> Copied!
                  </>
                ) : (
                  <>
                    <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy Link
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {isBundle && (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                  Bundle name
                </Label>
                <Input
                  type="text"
                  placeholder={`${shareFiles.length} shared files`}
                  value={bundleName}
                  onChange={(e) => setBundleName(e.target.value)}
                  className="h-9 bg-secondary/50 border-border"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <Users className="h-3.5 w-3.5 text-muted-foreground" /> Share
                with users
              </Label>
              <Input
                type="text"
                placeholder={
                  orgId
                    ? "Search organization members or enter emails"
                    : "Enter email addresses separated by commas"
                }
                value={sharedWithInput}
                onChange={(e) => setSharedWithInput(e.target.value)}
                className="h-9 bg-secondary/50 border-border"
              />
              {orgId && (
                <div className="rounded-md border border-border bg-secondary/20 p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Organization members
                    </span>
                    {orgMembersLoading && (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  {orgMemberSuggestions.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {orgMemberSuggestions.map((member) => {
                        const email = member.user?.email || "";
                        const label = member.user?.name || email;
                        return (
                          <button
                            key={member.userId}
                            type="button"
                            onClick={() => addOrgRecipient(email)}
                            className="flex min-w-0 items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-secondary"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-foreground">
                                {label}
                              </span>
                              {member.user?.name && (
                                <span className="block truncate text-muted-foreground">
                                  {email}
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                              {member.role}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      {orgMembersLoading
                        ? "Loading members..."
                        : orgMemberQuery
                          ? "No matching members"
                          : "No members available"}
                    </p>
                  )}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                {isBundle
                  ? "Multi-file shares use one public link. Direct email sharing is available for a single file."
                  : "Adding emails creates an authenticated direct share. Leave this empty to generate a public link instead."}
              </p>
            </div>

            {sharedWithInput.trim() && !isBundle && (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  Permission
                </Label>
                <Select
                  value={shareRole}
                  onValueChange={(value) => setShareRole(value as ShareRole)}
                >
                  <SelectTrigger className="h-9 bg-secondary/50 border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    className="z-[200] border-border bg-card"
                  >
                    <SelectItem value="viewer">
                      Viewer — preview &amp; download
                    </SelectItem>
                    <SelectItem value="commenter">
                      Commenter — + add comments
                    </SelectItem>
                    <SelectItem value="editor">
                      Editor — + rename &amp; edit
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Applies to everyone you add to this share.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" /> Link
                Expiry
              </Label>
              <Select value={expiresIn} onValueChange={setExpiresIn}>
                <SelectTrigger className="h-9 bg-secondary/50 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className="bg-card border-border z-[200]">
                  <SelectItem value="never">Never expires</SelectItem>
                  <SelectItem value="1">1 hour</SelectItem>
                  <SelectItem value="24">24 hours</SelectItem>
                  <SelectItem value="168">7 days</SelectItem>
                  <SelectItem value="720">30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Max Downloads (optional)
              </Label>
              <Input
                type="number"
                placeholder="Unlimited"
                min="1"
                value={maxDl}
                onChange={(e) => setMaxDl(e.target.value)}
                className="h-9 bg-secondary/50 border-border"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />{" "}
                  Password Protect
                </Label>
                <Switch checked={usePass} onCheckedChange={setUsePass} />
              </div>
              {usePass && (
                <Input
                  type="password"
                  placeholder="Set a password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  className="h-9 bg-secondary/50 border-border"
                />
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
              </div>
            )}

            <Button
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={create}
              disabled={creating || (usePass && !pass)}
            >
              {creating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Share…
                </>
              ) : (
                <>
                  <Link2 className="mr-2 h-4 w-4" />
                  {sharedWithInput.trim()
                    ? "Create Secure Share"
                    : "Create Share Link"}
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Copy,
  Check,
  Link2,
  Lock,
  Clock,
  Loader2,
  AlertCircle,
  Globe,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { useCrypto } from "@/contexts/CryptoContext";
import {
  decryptMetadataString,
  decryptThumbnail,
  encryptWithShareKey,
} from "@/lib/crypto/fileEncryption";
import { fromB64, toB64 } from "@/lib/crypto/utils";
import {
  bytesToBase64Url,
  decryptOwnerShareKey,
  encryptShareKeyForOwner,
  importShareKey,
} from "@/lib/crypto/shareKey";
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
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SharePhoto {
  objectId: string;
  /** B2 key of the encrypted thumbnail (from the grid), or null. */
  thumbnail: string | null;
}

interface AlbumShareDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Album id or slug — used in the API path. */
  albumId: string;
  albumName: string;
  /** Current photos in the album, with their thumbnail keys. */
  photos: SharePhoto[];
}

const CONCURRENCY = 4;

export function AlbumShareDialog({
  open,
  onOpenChange,
  albumId,
  albumName,
  photos,
}: AlbumShareDialogProps) {
  const { metadataKey, privateKey, publicKey, setModalOpen } = useCrypto();

  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{
    token: string;
    shareUrl: string;
    itemCount: number;
    itemObjectIds?: string[];
    ownerEncryptedShareKey?: string | null;
  } | null>(null);

  const [expiresIn, setExpiresIn] = useState("never");
  const [maxViews, setMaxViews] = useState("");
  const [usePass, setUsePass] = useState(false);
  const [pass, setPass] = useState("");

  // Check for an existing active share when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/albums/${albumId}/share`, {
          credentials: "include",
        });
        const data = await res.json();
        if (!cancelled && res.ok && data.share) {
          setExisting(data.share);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, albumId]);

  const processObject = useCallback(async (
    photo: SharePhoto,
    shareKeyObj: CryptoKey,
    bucketId: string,
    shareNonce: string,
  ) => {
    const objectId = photo.objectId;
    const metaRes = await fetch(`/api/objects/${objectId}`, {
      credentials: "include",
    });
    const meta = await metaRes.json();
    if (!metaRes.ok) throw new Error(meta.error || "Failed to read photo");

    const item: Record<string, string> = { objectId };

    if (meta.isEncrypted) {
      if (!meta.encryptedDEK) throw new Error("Photo missing encryption key");
      if (!privateKey) throw new Error("Vault locked");

      // Unwrap the file DEK (RSA), then re-wrap it under the album share key.
      const rawDEK = await crypto.subtle.decrypt(
        { name: "RSA-OAEP" },
        privateKey,
        fromB64(meta.encryptedDEK).buffer as ArrayBuffer,
      );
      const dekKey = await crypto.subtle.importKey(
        "raw",
        rawDEK,
        { name: "AES-GCM" },
        true,
        ["encrypt", "decrypt"],
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const wrapped = await crypto.subtle.wrapKey("raw", dekKey, shareKeyObj, {
        name: "AES-GCM",
        iv,
      });
      item.shareEncryptedDEK = toB64(wrapped);
      item.shareKeyIv = toB64(iv);

      // Re-encrypt name + content type under the share key.
      if (metadataKey) {
        const encName = meta.encryptedName;
        if (encName) {
          const plain = await decryptMetadataString(encName, metadataKey);
          item.shareEncryptedName = await encryptWithShareKey(plain, shareKeyObj);
        }
        if (meta.encryptedContentType) {
          const plainType = await decryptMetadataString(
            meta.encryptedContentType,
            metadataKey,
          );
          item.shareEncryptedContentType = await encryptWithShareKey(
            plainType,
            shareKeyObj,
          );
        }
      }
    }

    // Best-effort: re-encrypt the thumbnail under the share key and upload it
    // to B2 so anonymous viewers see a grid preview.
    try {
      if (photo.thumbnail && metadataKey && bucketId) {
        const urlRes = await fetch("/api/objects/thumbnail/batch", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keys: [photo.thumbnail] }),
        });
        const { urls } = await urlRes.json();
        const signed = urls?.[photo.thumbnail];
        if (signed) {
          const content = await (await fetch(signed)).text();
          const dataUrl = content.startsWith("enc:")
            ? await decryptThumbnail(content, metadataKey)
            : content;
          const reEncrypted = await encryptWithShareKey(dataUrl, shareKeyObj);

          const presignRes = await fetch("/api/objects/presign-upload", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              bucketId,
              prefix: "shares/",
              // Unique per share — a deterministic key would let the CDN/browser
              // serve a previous share's ciphertext (wrong share key) from cache.
              fileName: `album-${objectId}-${shareNonce}-thumb`,
              fileType: "application/octet-stream",
              fileSize: reEncrypted.length,
            }),
          });
          const { uploadUrl, objectKey } = await presignRes.json();
          if (uploadUrl && objectKey) {
            await fetch(uploadUrl, {
              method: "PUT",
              body: reEncrypted,
              headers: { "Content-Type": "application/octet-stream" },
            });
            item.shareEncryptedThumbnail = objectKey;
          }
        }
      }
    } catch (thumbErr) {
      console.warn("Failed to prepare shared thumbnail", thumbErr);
    }

    return item;
  }, [metadataKey, privateKey]);

  const create = useCallback(async () => {
    if (photos.length === 0) {
      setError("This album has no photos to share.");
      return;
    }
    if (!privateKey) {
      setModalOpen(true);
      setError("Unlock your vault to create a share.");
      return;
    }

    setCreating(true);
    setError(null);
    setProgress(0);

    try {
      // Random per-share id so this share's thumbnails live at fresh B2 keys,
      // never colliding with a prior share's cached (differently-keyed) blobs.
      const shareNonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(8)));

      let shareKeyRaw: Uint8Array;
      let ownerEncryptedShareKey: string | undefined;
      if (existing?.ownerEncryptedShareKey) {
        shareKeyRaw = await decryptOwnerShareKey(
          existing.ownerEncryptedShareKey,
          privateKey,
        );
      } else {
        if (!publicKey) {
          setModalOpen(true);
          setError("Unlock your vault to create a share.");
          return;
        }
        shareKeyRaw = crypto.getRandomValues(new Uint8Array(32));
        ownerEncryptedShareKey = await encryptShareKeyForOwner(
          shareKeyRaw,
          publicKey,
        );
      }
      const shareKeyObj = await importShareKey(shareKeyRaw, [
        "wrapKey",
        "encrypt",
      ]);

      // Need the user's bucket for thumbnail uploads.
      let bucketId = "";
      try {
        const cfg = await (await fetch("/api/drive/config")).json();
        bucketId = cfg?.bucket?._id ?? "";
      } catch {
        /* thumbnails simply won't upload */
      }

      const existingIds = new Set(existing?.itemObjectIds ?? []);
      const photosToShare = existing
        ? photos.filter((photo) => !existingIds.has(photo.objectId))
        : photos;

      const items: Array<Record<string, string>> = [];
      let done = 0;
      for (let i = 0; i < photosToShare.length; i += CONCURRENCY) {
        const batch = photosToShare.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          batch.map((photo) =>
            processObject(photo, shareKeyObj, bucketId, shareNonce).catch((e) => {
              console.warn(`Skipping photo ${photo.objectId}:`, e);
              return null;
            }),
          ),
        );
        for (const r of results) if (r) items.push(r);
        done += batch.length;
        setProgress(
          photosToShare.length > 0
            ? Math.round((done / photosToShare.length) * 100)
            : 100,
        );
      }

      if (!existing && items.length === 0) {
        throw new Error("Could not prepare any photos for sharing.");
      }

      const shareEncryptedAlbumName = await encryptWithShareKey(
        albumName,
        shareKeyObj,
      );

      const res = await fetch(`/api/albums/${albumId}/share`, {
        method: existing?.ownerEncryptedShareKey ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          shareEncryptedAlbumName,
          ...(ownerEncryptedShareKey && { ownerEncryptedShareKey }),
          ...(expiresIn !== "never" && { expiresIn: parseInt(expiresIn, 10) }),
          ...(maxViews && { maxViews: parseInt(maxViews, 10) }),
          ...(usePass && pass && { password: pass }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create share");

      const fragment = bytesToBase64Url(shareKeyRaw);
      const nextShareUrl = data.share?.shareUrl || data.shareUrl || existing?.shareUrl;
      setShareUrl(`${nextShareUrl}#key=${fragment}`);
      setExisting(data.share ?? null);
      toast.success(existing ? "Album share link updated" : "Album share link created");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create share");
    } finally {
      setCreating(false);
    }
  }, [
    albumId,
    albumName,
    existing,
    photos,
    privateKey,
    processObject,
    publicKey,
    expiresIn,
    maxViews,
    usePass,
    pass,
    setModalOpen,
  ]);

  async function revoke() {
    try {
      await fetch(`/api/albums/${albumId}/share`, {
        method: "DELETE",
        credentials: "include",
      });
      setExisting(null);
      setShareUrl(null);
      toast.success("Share link revoked");
    } catch {
      toast.error("Failed to revoke link");
    }
  }

  async function copyExisting() {
    if (!existing?.ownerEncryptedShareKey) {
      setError("This older link needs to be refreshed once before it can be copied again.");
      return;
    }
    if (!privateKey) {
      setModalOpen(true);
      setError("Unlock your vault to copy this share link.");
      return;
    }
    try {
      const raw = await decryptOwnerShareKey(
        existing.ownerEncryptedShareKey,
        privateKey,
      );
      const url = `${existing.shareUrl}#key=${bytesToBase64Url(raw)}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Link copied");
    } catch {
      setError("Could not decrypt this share link. Refresh it to rotate the key.");
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
    setCopied(false);
    setError(null);
    setProgress(0);
    setExpiresIn("never");
    setMaxViews("");
    setUsePass(false);
    setPass("");
  }

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
            <Globe className="h-4 w-4 text-primary" /> Share Album
          </DialogTitle>
          <DialogDescription className="break-all text-xs text-muted-foreground">
            {albumName} • {photos.length} photo
            {photos.length === 1 ? "" : "s"}
          </DialogDescription>
        </DialogHeader>

        {shareUrl ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-secondary/40 border border-border p-3 space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Public Link
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
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-400">
              The decryption key is in the link fragment. Anyone with this link
              can view and download the photos — share only with people you
              trust.
            </div>
            <Button
              size="sm"
              className="w-full bg-primary hover:bg-primary/90"
              onClick={copy}
            >
              {copied ? "Copied!" : "Copy Link"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {existing && (
              <div className="rounded-lg bg-secondary/40 border border-border p-3 text-xs space-y-2">
                <p className="text-muted-foreground">
                  This album already has an active public link ({existing.itemCount}{" "}
                  photo{existing.itemCount === 1 ? "" : "s"}).
                  {photos.length > existing.itemCount ? (
                    <span className="text-amber-400">
                      {" "}
                      {photos.length - existing.itemCount} new photo
                      {photos.length - existing.itemCount === 1 ? "" : "s"} added
                      since — refresh the link to include{" "}
                      {photos.length - existing.itemCount === 1 ? "it" : "them"}.
                    </span>
                  ) : (
                    " Refreshing replaces it with a new link."
                  )}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-border text-destructive"
                  onClick={revoke}
                >
                  <Trash2 className="mr-1.5 h-3 w-3" /> Revoke current link
                </Button>
                {existing.ownerEncryptedShareKey && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-border"
                    onClick={copyExisting}
                  >
                    <Copy className="mr-1.5 h-3 w-3" />
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                )}
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
                <SelectContent
                  position="popper"
                  className="bg-card border-border z-[200]"
                >
                  <SelectItem value="never">Never expires</SelectItem>
                  <SelectItem value="24">24 hours</SelectItem>
                  <SelectItem value="168">7 days</SelectItem>
                  <SelectItem value="720">30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Max Views (optional)</Label>
              <Input
                type="number"
                placeholder="Unlimited"
                min="1"
                value={maxViews}
                onChange={(e) => setMaxViews(e.target.value)}
                className="h-9 bg-secondary/50 border-border"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" /> Password
                  Protect
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

            {creating && (
              <div className="space-y-1.5">
                <Progress value={progress} className="h-2" />
                <p className="text-[11px] text-muted-foreground text-center">
                  Encrypting photos for sharing… {progress}%
                </p>
              </div>
            )}

            <Button
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={create}
              disabled={creating || (usePass && !pass)}
            >
              {creating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…
                </>
              ) : (
                <>
                  <Link2 className="mr-2 h-4 w-4" />{" "}
                  {existing ? "Update Public Link" : "Create Public Link"}
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

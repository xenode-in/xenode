"use client";
import { useState } from "react";
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
} from "lucide-react";
import { useCrypto } from "@/contexts/CryptoContext";
import { decryptMetadataString, encryptWithShareKey } from "@/lib/crypto/fileEncryption";
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
  /**
   * For E2EE files: called to get the raw 32-byte DEK (Uint8Array).
   * The caller should RSA-OAEP-decrypt the file's encryptedDEK using privateKey.
   */
  getDEKBytes?: (fileId: string) => Promise<Uint8Array>;
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
  getDEKBytes,
}: ShareDialogProps) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const { metadataKey } = useCrypto();
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState("never");
  const [maxDl, setMaxDl] = useState("");
  const [usePass, setUsePass] = useState(false);
  const [pass, setPass] = useState("");
  const [sharedWithInput, setSharedWithInput] = useState("");

  async function create() {
    if (!file) return;
    setCreating(true);
    setError(null);
    try {
      let shareEncryptedDEK: string | undefined;
      let shareKeyIv: string | undefined;
      let shareEncryptedName: string | undefined;
      let shareEncryptedContentType: string | undefined;
      let shareEncryptedThumbnail: string | undefined;
      let fragment: string | undefined;

      const body: Record<string, unknown> = {
        objectId: file.id,
        accessType: "download",
        ...(expiresIn !== "never" && { expiresIn: parseInt(expiresIn) }),
        ...(maxDl && { maxDownloads: parseInt(maxDl) }),
        ...(usePass && pass && { password: pass }),
        ...(sharedWithInput && { sharedWith: sharedWithInput.split(",").map(s => s.trim()).filter(Boolean) }),
      };

      if (file.isEncrypted && getDEKBytes) {
        const dekBytes = await getDEKBytes(file.id);

        // 1. Generate a fresh random 256-bit share key
        const shareKeyRaw = crypto.getRandomValues(new Uint8Array(32));
        const shareKeyObj = await crypto.subtle.importKey(
          "raw",
          shareKeyRaw,
          { name: "AES-GCM" },
          false,
          ["wrapKey", "encrypt", "decrypt"],
        );

        // 2. Generate the token locally so we can use it for the B2 path
        const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
        const token = bytesToB64url(tokenBytes);

        // 3. Import the DEK so we can wrap it
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

        // 4. Wrap DEK with share key
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const wrapped = await crypto.subtle.wrapKey(
          "raw",
          dekKey,
          shareKeyObj,
          { name: "AES-GCM", iv },
        );

        shareEncryptedDEK = bytesToB64(wrapped);
        shareKeyIv = bytesToB64(iv);
        // The raw share key goes ONLY in the URL fragment (never to server)
        fragment = bytesToB64url(shareKeyRaw);

        // 5. Re-encrypt metadata with share key
        if (metadataKey) {
          const nameToDecrypt = file.encryptedDisplayName || file.encryptedName;
          if (nameToDecrypt) {
            const plaintextName = await decryptMetadataString(nameToDecrypt, metadataKey);
            shareEncryptedName = await encryptWithShareKey(plaintextName, shareKeyObj);
          }
          if (file.encryptedContentType) {
            const plaintextType = await decryptMetadataString(file.encryptedContentType, metadataKey);
            shareEncryptedContentType = await encryptWithShareKey(plaintextType, shareKeyObj);
          }
          if (file.thumbnail && file.thumbnail.startsWith("enc:")) {
            const { decryptThumbnail } = await import("@/lib/crypto/fileEncryption");
            const plaintextThumb = await decryptThumbnail(file.thumbnail, metadataKey);
            const shareEncThumbB64 = await encryptWithShareKey(plaintextThumb, shareKeyObj);
            
            // OPTION B: Store in B2 at shares/{token}-thumb
            try {
              // Get user's config for bucketId
              const configRes = await fetch("/api/drive/config");
              const config = await configRes.json();
              if (config.bucket) {
                const presignRes = await fetch("/api/objects/presign-upload", {
                  method: "POST",
                  body: JSON.stringify({
                    bucketId: config.bucket._id,
                    prefix: "shares/",
                    fileName: `${token}-thumb`,
                    fileType: "application/octet-stream",
                    fileSize: shareEncThumbB64.length,
                  }),
                });
                const { uploadUrl, objectKey } = await presignRes.json();
                
                await fetch(uploadUrl, {
                  method: "PUT",
                  body: shareEncThumbB64,
                  headers: { "Content-Type": "application/octet-stream" },
                });
                
                shareEncryptedThumbnail = objectKey;
              }
            } catch (err) {
              console.error("Failed to upload shared thumbnail to B2", err);
              // Fallback to legacy inline if B2 fails? No, requirement is Option B.
            }
          }
        }
        
        // Pass the token we generated
        (body as any).token = token;
        if (shareEncryptedDEK) body.shareEncryptedDEK = shareEncryptedDEK;
        if (shareKeyIv) body.shareKeyIv = shareKeyIv;
        if (shareEncryptedName) body.shareEncryptedName = shareEncryptedName;
        if (shareEncryptedContentType) body.shareEncryptedContentType = shareEncryptedContentType;
        if (shareEncryptedThumbnail) body.shareEncryptedThumbnail = shareEncryptedThumbnail;
      }
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setShareUrl(
        fragment ? `${data.shareUrl}#key=${fragment}` : data.shareUrl,
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create link");
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
    setCopied(false);
    setError(null);
    setExpiresIn("never");
    setMaxDl("");
    setUsePass(false);
    setPass("");
    setSharedWithInput("");
  }

  const displayName = file?.key.split("/").pop() ?? file?.key ?? "";

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
            <Link2 className="h-4 w-4 text-primary" /> Share File
          </DialogTitle>
          <DialogDescription className="break-all text-xs text-muted-foreground">
            {displayName}
            {file?.isEncrypted && (
              <span className="ml-2 text-green-500 font-medium">
                • E2E Encrypted
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {shareUrl ? (
          <div className="space-y-4">
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

            {file?.isEncrypted && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-400">
                ⚠️ The decryption key is embedded in the URL fragment. Share
                this link only with people you trust — anyone with the full URL
                can decrypt the file.
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 border-border"
                onClick={reset}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> New Link
              </Button>
              <Button
                size="sm"
                className="flex-1 bg-primary hover:bg-primary/90"
                onClick={copy}
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
            {/* Shared With */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <Users className="h-3.5 w-3.5 text-muted-foreground" /> Share
                with users (optional)
              </Label>
              <Input
                type="text"
                placeholder="Enter email addresses separated by commas"
                value={sharedWithInput}
                onChange={(e) => setSharedWithInput(e.target.value)}
                className="h-9 bg-secondary/50 border-border"
              />
              <p className="text-[10px] text-muted-foreground">
                Specifying emails allows these users to see the file in their
                &quot;Shared with me&quot; dashboard.
              </p>
            </div>

            {/* Expiry */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" /> Link
                Expiry
              </Label>
              <Select value={expiresIn} onValueChange={setExpiresIn}>
                <SelectTrigger className="h-9 bg-secondary/50 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="never">Never expires</SelectItem>
                  <SelectItem value="1">1 hour</SelectItem>
                  <SelectItem value="24">24 hours</SelectItem>
                  <SelectItem value="168">7 days</SelectItem>
                  <SelectItem value="720">30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Max downloads */}
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

            {/* Password protect */}
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
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating
                  Link…
                </>
              ) : (
                <>
                  <Link2 className="mr-2 h-4 w-4" /> Create Share Link
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

"use client";

const NOOP = () => {};
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Download,
  Lock,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Eye,
  X,
  FileStack,
} from "lucide-react";
import { getFileIcon } from "@/lib/file-icons";
import { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import dynamic from "next/dynamic";
import { useVideoStream, VideoStreamOptions } from "@/hooks/useVideoStream";
import { getCachedResponse, storeCachedStream } from "@/lib/cache/previewCache";
import {
  decryptWithShareKey,
  decryptThumbnail,
} from "@/lib/crypto/fileEncryption";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useThumbnail } from "@/hooks/useThumbnail";
import { Navbar } from "@/components/Navbar";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { FilePreviewDialog } from "@/components/dashboard/FilePreviewDialog";

interface ShareMeta {
  id?: string;
  name?: string;
  fileName: string;
  size: number;
  contentType: string;
  isEncrypted: boolean;
  thumbnail?: string;
  isPasswordProtected: boolean;
  expiresAt?: string;
  downloadCount: number;
  maxDownloads?: number;
  shareEncryptedDEK?: string;
  shareKeyIv?: string;
  shareEncryptedName?: string;
  shareEncryptedContentType?: string;
  mediaCategory?: string;
  isBundle?: boolean;
  bundleName?: string;
  items?: ShareMetaItem[];
}

interface ShareMetaItem {
  id: string;
  name?: string;
  fileName?: string;
  size: number;
  contentType: string;
  isEncrypted: boolean;
  thumbnail?: string;
  shareEncryptedDEK?: string;
  shareKeyIv?: string;
  shareEncryptedName?: string;
  shareEncryptedContentType?: string;
  mediaCategory?: string;
}

function BundleFileCard({
  item,
  displayName,
  displayType,
  shareKeyObj,
  downloading,
  onPreview,
  onDownload,
}: {
  item: ShareMetaItem;
  displayName: string;
  displayType: string;
  shareKeyObj: CryptoKey | null;
  downloading: boolean;
  onPreview: () => void;
  onDownload: () => void;
}) {
  const thumbnailUrl = useThumbnail(item.thumbnail, shareKeyObj);

  return (
    <div className="group overflow-hidden rounded-xl border border-border bg-background/50 transition-colors hover:border-primary/40 hover:bg-secondary/20">
      <button
        type="button"
        onClick={onPreview}
        className="block w-full text-left"
      >
        <div className="flex aspect-video items-center justify-center bg-secondary/30">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={displayName}
              className="h-full w-full object-cover"
            />
          ) : (
            getFileIcon(displayType, "h-10 w-10", item.mediaCategory)
          )}
        </div>
        <div className="min-w-0 p-3">
          <p className="truncate text-sm font-medium">{displayName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatBytes(item.size)}
          </p>
        </div>
      </button>
      <div className="border-t border-border/60 p-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-full"
          onClick={onDownload}
          disabled={downloading}
        >
          {downloading ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="mr-2 h-3.5 w-3.5" />
          )}
          Download
        </Button>
      </div>
    </div>
  );
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function b64urlToBytes(s: string): Uint8Array {
  return b64ToBytes(
    s
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(s.length + ((4 - (s.length % 4)) % 4), "="),
  );
}
function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

async function fetchWithProgress(
  url: string,
  onProgress: (pct: number) => void,
  cacheKey?: string,
  fileSizeBytes?: number,
): Promise<ArrayBuffer> {
  let stream: ReadableStream<Uint8Array>;
  let total = fileSizeBytes || 0;
  let fromCache = false;

  if (cacheKey) {
    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      stream = cached.body!;
      total = +(cached.headers.get("x-content-length") ?? 0) || total;
      fromCache = true;
    }
  }

  if (!stream!) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch file");
    total = +(res.headers.get("content-length") ?? 0) || total;
    if (cacheKey) {
      const [forCache, forRead] = res.body!.tee();
      storeCachedStream(cacheKey, forCache, total).catch(() => {});
      stream = forRead;
    } else {
      stream = res.body!;
    }
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  if (fromCache) onProgress(100);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total > 0 && !fromCache) {
      onProgress(Math.round((received / total) * 100));
    }
  }

  const combined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

export default function SharedFilePage() {
  const { token } = useParams<{ token: string }>();
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadReceived, setDownloadReceived] = useState(0);
  const [done, setDone] = useState(false);
  const [decryptedName, setDecryptedName] = useState<string | null>(null);
  const [decryptedContentType, setDecryptedContentType] = useState<
    string | null
  >(null);
  const [decryptedItems, setDecryptedItems] = useState<
    Record<string, { name?: string; contentType?: string }>
  >({});
  const [shareKey, setShareKey] = useState("");
  const [shareKeyObj, setShareKeyObj] = useState<CryptoKey | null>(null);
  const [isKeyValid, setIsKeyValid] = useState(true);
  const [isKeyMissing, setIsKeyMissing] = useState(false);

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<ShareMetaItem | null>(null);
  const decryptedThumbnailUrl = useThumbnail(meta?.thumbnail, shareKeyObj);

  // Sync shareKey from URL hash
  useEffect(() => {
    if (typeof window !== "undefined") {
      const updateKey = () => {
        const hash = window.location.hash;
        if (hash.startsWith("#key=")) {
          setShareKey(hash.replace("#key=", ""));
          setIsKeyMissing(false);
        } else {
          setIsKeyMissing(true);
        }
      };
      updateKey();
      window.addEventListener("hashchange", updateKey);

      // Pre-register Service Worker for high-performance streaming
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch((err) => {
          console.warn("Service Worker registration failed:", err);
        });
      }

      return () => window.removeEventListener("hashchange", updateKey);
    }
  }, []);

  const displayName =
    decryptedName ||
    (meta?.isBundle && meta.bundleName ? meta.bundleName : null) ||
    (meta?.fileName ? meta.fileName.split("/").pop() : "File") ||
    "File";

  const fileStub = useMemo(() => {
    if (!meta) return null;
    if (previewItem) {
      const itemDecrypted = decryptedItems[previewItem.id];
      const itemName =
        itemDecrypted?.name ||
        previewItem.fileName ||
        previewItem.name ||
        "Shared file";
      return {
        id: previewItem.id,
        key: itemName,
        size: previewItem.size,
        contentType:
          itemDecrypted?.contentType || previewItem.contentType,
        isEncrypted: previewItem.isEncrypted,
        name: itemName,
        mediaCategory: previewItem.mediaCategory,
      };
    }
    return {
      id: token as string,
      key: meta.fileName || "",
      size: meta.size,
      contentType: decryptedContentType || meta.contentType,
      isEncrypted: meta.isEncrypted,
      name: displayName,
      mediaCategory: meta.mediaCategory,
    };
  }, [meta, previewItem, decryptedItems, token, decryptedContentType, displayName]);

  // Consolidated data loader
  useEffect(() => {
    if (!token) return;

    const loadData = async () => {
      try {
        const res = await fetch(`/api/share/${token}`);
        const d = await res.json();

        if (d.error) {
          setError(d.error);
        } else {
          // Map 'name' from API to 'fileName' expected by UI if missing
          if (d.name && !d.fileName) {
            d.fileName = d.name;
          }
          setMeta(d);

          // Decrypt shared metadata if key is present in hash
          if (
            shareKey &&
            (d.shareEncryptedName ||
              d.items?.some((item: ShareMetaItem) => item.shareEncryptedName))
          ) {
            try {
              const skBytes = b64urlToBytes(shareKey);
              const shareKeyObj = await crypto.subtle.importKey(
                "raw",
                skBytes.buffer.slice(
                  skBytes.byteOffset,
                  skBytes.byteOffset + skBytes.byteLength,
                ) as ArrayBuffer,
                { name: "AES-GCM" },
                false,
                ["decrypt", "unwrapKey"],
              );
              setShareKeyObj(shareKeyObj);
              if (d.shareEncryptedName) {
                const name = await decryptWithShareKey(
                  d.shareEncryptedName,
                  shareKeyObj,
                );
                setDecryptedName(name);
              }

              if (d.shareEncryptedContentType) {
                const type = await decryptWithShareKey(
                  d.shareEncryptedContentType,
                  shareKeyObj,
                );
                setDecryptedContentType(type);
              }
              if (Array.isArray(d.items)) {
                const nextItems: Record<
                  string,
                  { name?: string; contentType?: string }
                > = {};
                for (const item of d.items as ShareMetaItem[]) {
                  const nextItem: { name?: string; contentType?: string } = {};
                  if (item.shareEncryptedName) {
                    nextItem.name = await decryptWithShareKey(
                      item.shareEncryptedName,
                      shareKeyObj,
                    );
                  }
                  if (item.shareEncryptedContentType) {
                    nextItem.contentType = await decryptWithShareKey(
                      item.shareEncryptedContentType,
                      shareKeyObj,
                    );
                  }
                  nextItems[item.id] = nextItem;
                }
                setDecryptedItems(nextItems);
              }
              setIsKeyValid(true);
            } catch (err) {
              console.error("Failed to decrypt shared file metadata", err);
              setIsKeyValid(false);
            }
          }
        }
      } catch (err) {
        setError("Failed to load share info");
      }
    };

    loadData();
  }, [token, shareKey]);

  const handlePreview = useCallback(() => {
    setPreviewItem(null);
    setIsPreviewOpen(true);
  }, []);

  const handlePreviewItem = useCallback((item: ShareMetaItem) => {
    setPreviewItem(item);
    setIsPreviewOpen(true);
  }, []);

  const handleDownload = useCallback(async (item?: ShareMetaItem) => {
    if (!meta) return;
    const target = item || meta;
    const targetDecrypted = item ? decryptedItems[item.id] : undefined;
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`/api/share/${token}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: password || undefined,
          itemId: item?.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load stream info");

      const shareEncryptedDEK =
        data.shareEncryptedDEK || target.shareEncryptedDEK;

      if (data.isEncrypted && (!shareKey || !shareEncryptedDEK)) {
        throw new Error("Missing decryption key.");
      }

      let blob: Blob;
      if (data.isEncrypted && shareKey && shareEncryptedDEK) {
        setDownloadProgress(0);
        const skBytes = b64urlToBytes(shareKey);
        const shareKeyObj = await crypto.subtle.importKey(
          "raw",
          bytesToArrayBuffer(skBytes),
          { name: "AES-GCM" },
          false,
          ["unwrapKey"],
        );
        const encryptedDekBytes = b64ToBytes(shareEncryptedDEK);
        const shareKeyIvBytes = b64ToBytes(data.shareKeyIv || meta.shareKeyIv!);

        const dek = await crypto.subtle.unwrapKey(
          "raw",
          bytesToArrayBuffer(encryptedDekBytes),
          shareKeyObj,
          { name: "AES-GCM", iv: bytesToArrayBuffer(shareKeyIvBytes) },
          { name: "AES-GCM" },
          false,
          ["decrypt"],
        );

        if (data.chunkUrls) {
          const { decryptChunk } = await import("@/lib/crypto/fileEncryption");
          const chunkIvsArr = JSON.parse(data.chunkIvs);
          const plaintextChunks = [];
          for (let i = 0; i < data.chunkUrls.length; i++) {
            const cr = await fetch(data.chunkUrls[i]);
            const cb = await cr.arrayBuffer();
            plaintextChunks.push(await decryptChunk(cb, dek, chunkIvsArr[i]));
            setDownloadProgress(
              Math.round(((i + 1) / data.chunkUrls.length) * 100),
            );
          }
          blob = new Blob(plaintextChunks, {
            type:
              targetDecrypted?.contentType ||
              decryptedContentType ||
              data.contentType,
          });
        } else {
          const fileUrl = data.downloadUrl || data.streamUrl;
          if (!fileUrl) throw new Error("No download URL returned");
          const raw = await fetchWithProgress(
            fileUrl,
            setDownloadProgress,
            undefined,
            target.size,
          );
          const ivBytes = b64ToBytes(data.iv);
          const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: bytesToArrayBuffer(ivBytes) },
            dek,
            raw,
          );
          blob = new Blob([decrypted], {
            type:
              targetDecrypted?.contentType ||
              decryptedContentType ||
              data.contentType,
          });
        }
      } else {
        const fileUrl = data.downloadUrl || data.streamUrl;
        if (!fileUrl) throw new Error("No download URL returned");
        const raw = await fetchWithProgress(
          fileUrl,
          setDownloadProgress,
          undefined,
          target.size,
        );
        blob = new Blob([raw], {
          type:
            targetDecrypted?.contentType ||
            decryptedContentType ||
            data.contentType,
        });
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        targetDecrypted?.name ||
        decryptedName ||
        data.fileName ||
        target.fileName ||
        target.name ||
        "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }, [
    meta,
    token,
    password,
    shareKey,
    decryptedName,
    decryptedContentType,
    decryptedItems,
  ]);

  const handleClosePreview = useCallback(() => {
    setIsPreviewOpen(false);
    setPreviewItem(null);
  }, []);

  const shareRequiresKey =
    !!meta?.isEncrypted || !!meta?.items?.some((item) => item.isEncrypted);

  if (isKeyMissing && shareRequiresKey) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="grow flex items-center justify-center p-4 md:p-8 relative overflow-hidden bg-background">
          <Card className="w-full max-w-md relative z-10 shadow-2xl border-border/50 backdrop-blur-sm bg-card/90 text-center p-8">
            <Lock className="mx-auto h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h2 className="text-xl font-semibold tracking-tight">
              Missing decryption key
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              This file is end-to-end encrypted. The link must include a key to
              access it.
            </p>
          </Card>
        </main>
        <LandingFooter />
      </div>
    );
  }

  if (!isKeyValid) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="grow flex items-center justify-center p-4 md:p-8 relative overflow-hidden bg-background">
          <Card className="w-full max-w-md relative z-10 shadow-2xl border-border/50 backdrop-blur-sm bg-card/90 text-center p-8">
            <AlertCircle className="mx-auto h-12 w-12 text-destructive mb-4 opacity-80" />
            <h2 className="text-xl font-semibold tracking-tight">
              Invalid or broken link
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              The decryption key is incorrect or the file no longer exists.
            </p>
          </Card>
        </main>
        <LandingFooter />
      </div>
    );
  }

  if (error && !meta)
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="grow flex items-center justify-center p-4 md:p-8 relative overflow-hidden bg-background">
          <Card className="w-full max-w-md relative z-10 shadow-2xl border-border/50 backdrop-blur-sm bg-card/90 text-center p-8">
            <AlertCircle className="mx-auto h-12 w-12 text-destructive mb-4" />
            <p className="font-semibold text-foreground text-lg">{error}</p>
          </Card>
        </main>
        <LandingFooter />
      </div>
    );

  if (!meta)
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="grow flex items-center justify-center bg-background">
          <Loader2 className="h-10 w-10 animate-spin text-primary opacity-50" />
        </main>
        <LandingFooter />
      </div>
    );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="grow flex items-center justify-center p-4 md:p-8 relative overflow-hidden bg-background">
        <Card className={`w-full ${meta.isBundle ? "max-w-3xl" : "max-w-md"} relative z-10 shadow-2xl border-border/50 backdrop-blur-sm bg-card/90`}>
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 overflow-hidden shadow-inner">
              {meta.isBundle ? (
                <FileStack className="h-10 w-10 text-primary" />
              ) : decryptedThumbnailUrl ? (
                <img
                  src={decryptedThumbnailUrl}
                  alt={displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                getFileIcon(
                  decryptedContentType || meta.contentType,
                  "h-10 w-10",
                  meta.mediaCategory,
                )
              )}
            </div>
            <CardTitle className="break-all text-xl font-semibold tracking-tight">
              {displayName}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {meta.isBundle && meta.items
                ? `${meta.items.length} files`
                : formatBytes(meta.size)}
            </p>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            {meta.isPasswordProtected && !done && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground ml-1">
                  Password Protected
                </label>
                <Input
                  type="password"
                  placeholder="Enter password to access"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-background/50"
                />
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}
            {meta.isBundle && meta.items ? (
              <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
                {meta.items.map((item) => {
                  const itemName =
                    decryptedItems[item.id]?.name ||
                    item.fileName ||
                    item.name ||
                    "Shared file";
                  const itemType =
                    decryptedItems[item.id]?.contentType || item.contentType;
                  return (
                    <BundleFileCard
                      key={item.id}
                      item={item}
                      displayName={itemName}
                      displayType={itemType}
                      shareKeyObj={shareKeyObj}
                      downloading={downloading}
                      onPreview={() => handlePreviewItem(item)}
                      onDownload={() => void handleDownload(item)}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 pt-2">
                <Button
                  className="w-full h-11 text-base font-medium transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
                  onClick={() => void handleDownload()}
                  disabled={downloading}
                >
                  {downloading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Downloading {downloadProgress}%
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Download File
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="w-full h-11 text-base font-medium bg-background/50 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
                  onClick={handlePreview}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Preview Online
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
      <LandingFooter />

      {(!meta.isBundle || previewItem) && (
        <FilePreviewDialog
          file={fileStub}
          isOpen={isPreviewOpen}
          onClose={handleClosePreview}
          sharedToken={token}
          sharedItemId={previewItem?.id}
          shareKey={shareKey}
          password={password}
        />
      )}
    </div>
  );
}

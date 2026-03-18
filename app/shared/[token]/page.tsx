"use client";
import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Download,
  Lock,
  File,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Eye,
  X,
} from "lucide-react";
import { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import dynamic from "next/dynamic";
import "plyr-react/plyr.css";
import {
  useVideoStream,
  VideoStreamOptions,
} from "@/hooks/useVideoStream";
import { getCachedResponse, storeCachedStream } from "@/lib/cache/previewCache";
import { cn } from "@/lib/utils";

// Dynamically import DocViewer and Plyr with SSR disabled
const DocViewer = dynamic(() => import("@cyntler/react-doc-viewer"), {
  ssr: false,
});
const Plyr = dynamic(() => import("plyr-react").then((mod) => mod.Plyr), {
  ssr: false,
});

interface ShareMeta {
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
}

interface StreamData {
  streamUrl?: string;
  chunkUrls?: string[];
  isEncrypted: boolean;
  iv?: string;
  contentType: string;
  fileName: string;
  chunkSize?: number;
  chunkCount?: number;
  chunkIvs?: string; // JSON string from server
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
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

/** Derive the shared DEK from the URL-fragment share key + the wrapped DEK in meta */
async function deriveDek(
  shareKeyB64url: string,
  shareEncryptedDEK: string,
  shareKeyIv: string,
): Promise<CryptoKey> {
  const skBytes = b64urlToBytes(shareKeyB64url);
  const shareKeyObj = await crypto.subtle.importKey(
    "raw",
    skBytes.buffer.slice(
      skBytes.byteOffset,
      skBytes.byteOffset + skBytes.byteLength,
    ) as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["unwrapKey"],
  );
  const shareEncryptedDekBytes = b64ToBytes(shareEncryptedDEK);
  const shareKeyIvBytes = b64ToBytes(shareKeyIv);
  return crypto.subtle.unwrapKey(
    "raw",
    shareEncryptedDekBytes.buffer.slice(
      shareEncryptedDekBytes.byteOffset,
      shareEncryptedDekBytes.byteOffset + shareEncryptedDekBytes.byteLength,
    ) as ArrayBuffer,
    shareKeyObj,
    {
      name: "AES-GCM",
      iv: shareKeyIvBytes.buffer.slice(
        shareKeyIvBytes.byteOffset,
        shareKeyIvBytes.byteOffset + shareKeyIvBytes.byteLength,
      ) as ArrayBuffer,
    },
    { name: "AES-GCM" },
    true, // Extractable = true
    ["decrypt"],
  );
}

/** Fetch a URL while invoking onProgress(0-100) as bytes arrive */
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
      console.log(`[PreviewCache] Cache hit for generic preview: ${cacheKey}`);
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

  if (fromCache) {
    onProgress(100); // instant jump
  }

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

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Inner component: download+decrypt encrypted video, then play in Plyr
// ─────────────────────────────────────────────────────────────────────────────
function ChunkedStreamPlayer({
  opts,
  contentType,
  onUrlChange,
}: {
  opts: VideoStreamOptions;
  contentType: string;
  onUrlChange: (url: string | null) => void;
}) {
  const isAudio = contentType.startsWith("audio/");
  const [videoElement, setVideoElement] = useState<HTMLMediaElement | null>(null);

  const { blobUrl, error, isBuffering } = useVideoStream(opts, videoElement);

  useEffect(() => {
    onUrlChange(blobUrl);
    return () => onUrlChange(null);
  }, [blobUrl, onUrlChange]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <AlertCircle className="mb-2 h-8 w-8 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn("relative flex h-full items-center justify-center", isAudio ? "w-full p-4" : "w-full bg-black")}>
      {isBuffering && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 backdrop-blur-sm pointer-events-none">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
        </div>
      )}
      
      {isAudio ? (
        <audio
          ref={(node) => setVideoElement(node)}
          controls
          autoPlay
          className="w-full"
          src={blobUrl || ""}
        />
      ) : (
        <video
          ref={(node) => setVideoElement(node)}
          controls
          autoPlay
          playsInline
          className="max-h-full max-w-full"
          src={blobUrl || ""}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page component
// ─────────────────────────────────────────────────────────────────────────────
export default function SharedFilePage() {
  const { token } = useParams<{ token: string }>();
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [done, setDone] = useState(false);
  const [shareKey, setShareKey] = useState("");

  // Preview state
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isFetchingForPreview, setIsFetchingForPreview] = useState(false);
  const [fetchProgress, setFetchProgress] = useState(0);

  // Path A: non-encrypted video → direct signed URL
  const [directStreamUrl, setDirectStreamUrl] = useState<string | null>(null);

  // Path B: chunked encrypted video → MSE via hook
  const [chunkedOpts, setChunkedOpts] = useState<VideoStreamOptions | null>(
    null,
  );

  // Path C: legacy encrypted or non-video → blob URL
  const [blobPreviewUrl, setBlobPreviewUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  // Share key is ONLY in the URL fragment
  useEffect(() => {
    if (typeof window !== "undefined") {
      setShareKey(window.location.hash.replace("#key=", ""));
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/share/${token}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setMeta(d)))
      .catch(() => setError("Failed to load share info"));
  }, [token]);

  // ── Preview handler ────────────────────────────────────────────────────────

  async function handlePreview() {
    if (!meta) return;
    setIsPreviewOpen(true);

    // Already have everything we need — just open the modal
    if (directStreamUrl || chunkedOpts || blobPreviewUrl) return;

    setError(null);

    const isMedia =
      meta.contentType.startsWith("video/") ||
      meta.contentType.startsWith("audio/");

    try {
      setIsFetchingForPreview(true);
      setFetchProgress(0);

      const res = await fetch(`/api/share/${token}/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password || undefined }),
      });
      const data: StreamData = await res.json();
      if (!res.ok)
        throw new Error((data as unknown as { error: string }).error);

      // ── PATH A: Non-encrypted media → pure signed-URL streaming ───────────
      if (isMedia && !data.isEncrypted && data.streamUrl) {
        setDirectStreamUrl(data.streamUrl);
        setIsFetchingForPreview(false);
        return;
      }

      // Guard: encrypted but no key in fragment
      if (data.isEncrypted && (!shareKey || !meta.shareEncryptedDEK)) {
        throw new Error(
          "This file is end-to-end encrypted but no decryption key was found in the link. " +
            "Make sure you're using the full link including the #key=… at the end.",
        );
      }

      // Derive DEK (needed for both chunked and legacy paths)
      let dek: CryptoKey | undefined;
      if (data.isEncrypted && meta.shareEncryptedDEK && meta.shareKeyIv) {
        dek = await deriveDek(
          shareKey,
          meta.shareEncryptedDEK,
          meta.shareKeyIv,
        );
      }

      // ── PATH B: Chunked encrypted media → SW or MSE streaming ────────────
      if (
        isMedia &&
        data.isEncrypted &&
        dek &&
        data.chunkSize &&
        data.chunkCount &&
        data.chunkIvs &&
        data.chunkUrls
      ) {
        const chunkIvsArr: string[] = JSON.parse(data.chunkIvs);
        const rawDEK = await crypto.subtle.exportKey("raw", dek);
        
        if ("serviceWorker" in navigator) {
          try {
            const registration = await navigator.serviceWorker.register("/sw.js");
            await navigator.serviceWorker.ready;
            
            let sw = navigator.serviceWorker.controller || registration.active;
            
            if (sw) {
              await new Promise<void>((resolve, reject) => {
                const channel = new MessageChannel();
                channel.port1.onmessage = (event) => {
                  if (event.data.success) resolve();
                  else reject(new Error("Failed to register stream with SW"));
                };
                if (sw?.state !== 'activated') {
                   sw?.addEventListener('statechange', () => {
                      if (sw?.state === 'activated') {
                         sw?.postMessage({
                          type: 'REGISTER_STREAM',
                          fileId: token,
                          rawDEK,
                          chunkSize: data.chunkSize || (2 * 1024 * 1024),
                          chunkCount: data.chunkCount || data.chunkUrls!.length,
                          chunkIvs: chunkIvsArr,
                          urls: data.chunkUrls,
                          contentType: data.contentType,
                          size: meta.size
                        }, [channel.port2]);
                      }
                   })
                } else {
                    sw.postMessage({
                      type: 'REGISTER_STREAM',
                      fileId: token,
                      rawDEK,
                      chunkSize: data.chunkSize || (2 * 1024 * 1024),
                      chunkCount: data.chunkCount || data.chunkUrls!.length,
                      chunkIvs: chunkIvsArr,
                      urls: data.chunkUrls,
                      contentType: data.contentType,
                      size: meta.size
                    }, [channel.port2]);
                }
              });

              setDirectStreamUrl(`/sw/objects/${token}`);
              setIsFetchingForPreview(false);
              return; // Done using SW
            }
          } catch (err) {
            console.error("SW streaming failed, falling back to MSE", err);
          }
        }
        
        // Fallback to MSE via chunkedOpts
        setChunkedOpts({
          urls: data.chunkUrls,
          dek,
          chunkSize: data.chunkSize,
          chunkCount: data.chunkCount,
          chunkIvs: chunkIvsArr,
          contentType: data.contentType,
        });
        setIsFetchingForPreview(false);
        return;
      }

      // ── PATH C: Legacy single-blob encrypted file OR non-media ────────────
      if (!data.streamUrl) throw new Error("Stream URL is missing for this file.");
      
      // Fetch full ciphertext (or plaintext if not E2EE) with progress tracking
      // Uses the same Cache Storage mechanism behind the scenes
      const raw = await fetchWithProgress(
        data.streamUrl,
        setFetchProgress,
        token,
        meta.size,
      );

      let blob: Blob;
      if (data.isEncrypted && dek && data.iv) {
        const ivBytes = b64ToBytes(data.iv);
        const decrypted = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: ivBytes.buffer.slice(
              ivBytes.byteOffset,
              ivBytes.byteOffset + ivBytes.byteLength,
            ) as ArrayBuffer,
          },
          dek,
          raw,
        );
        blob = new Blob([decrypted], { type: data.contentType });
      } else {
        blob = new Blob([raw], { type: data.contentType });
      }

      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setBlobPreviewUrl(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Preview failed");
      setIsPreviewOpen(false);
    } finally {
      setIsFetchingForPreview(false);
      setFetchProgress(0);
    }
  }

  // ── Download handler ───────────────────────────────────────────────────────

  async function handleDownload() {
    if (!meta) return;
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`/api/share/${token}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.isEncrypted && (!shareKey || !meta.shareEncryptedDEK)) {
        throw new Error(
          "Decryption key missing — make sure you're using the full link including the #key=… at the end.",
        );
      }

      let blob: Blob;

      if (
        data.isEncrypted &&
        shareKey &&
        meta.shareEncryptedDEK &&
        meta.shareKeyIv
      ) {
        const dek = await deriveDek(
          shareKey,
          meta.shareEncryptedDEK,
          meta.shareKeyIv,
        );

        // Chunked file: download chunks separately and decrypt
        if (data.chunkUrls && data.chunkUrls.length > 0 && data.chunkSize && data.chunkCount && data.chunkIvs) {
          const chunkIvsArr: string[] = JSON.parse(data.chunkIvs);
          const plaintextChunks: ArrayBuffer[] = [];
          const { decryptChunk } = await import("@/lib/crypto/fileEncryption");
          
          for (let i = 0; i < data.chunkCount; i++) {
            const chunkRes = await fetch(data.chunkUrls[i]);
            if (!chunkRes.ok) throw new Error(`Failed to fetch chunk ${i}`);
            const chunkBuf = await chunkRes.arrayBuffer();
            const plain = await decryptChunk(chunkBuf, dek, chunkIvsArr[i]);
            plaintextChunks.push(plain);
          }
          blob = new Blob(plaintextChunks, { type: data.contentType });
        } else {
          // Legacy single-blob
          if (!data.downloadUrl) throw new Error("Missing download URL");
          const fileRes = await fetch(data.downloadUrl);
          if (!fileRes.ok) throw new Error("Failed to fetch file");
          const raw = await fileRes.arrayBuffer();
          
          const ivBytes = b64ToBytes(data.iv);
          const decrypted = await crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv: ivBytes.buffer.slice(
                ivBytes.byteOffset,
                ivBytes.byteOffset + ivBytes.byteLength,
              ) as ArrayBuffer,
            },
            dek,
            raw,
          );
          blob = new Blob([decrypted], { type: data.contentType });
        }
      } else {
        // Not encrypted
        if (data.chunkUrls && data.chunkUrls.length > 0) {
          const chunks: BlobPart[] = [];
          for (const chunkUrl of data.chunkUrls) {
            const chunkRes = await fetch(chunkUrl);
            if (!chunkRes.ok) throw new Error("Failed to fetch chunk");
            chunks.push(await chunkRes.blob());
          }
          blob = new Blob(chunks, { type: data.contentType });
        } else {
          if (!data.downloadUrl) throw new Error("Missing download URL");
          const fileRes = await fetch(data.downloadUrl);
          if (!fileRes.ok) throw new Error("Failed to fetch file");
          blob = await fileRes.blob();
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        data.fileName || meta.fileName.split("/").pop() || "download";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDone(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  // ── Preview renderer ───────────────────────────────────────────────────────

  const renderPreview = () => {
    if (!meta) return null;

    // Loading screen while fetching/decrypting
    if (isFetchingForPreview) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          {fetchProgress > 0 ? (
            <>
              <div className="w-64 h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-200"
                  style={{ width: `${fetchProgress}%` }}
                />
              </div>
              <p className="text-sm">
                {meta.isEncrypted ? "Decrypting" : "Loading"} {fetchProgress}%
              </p>
            </>
          ) : (
            <p className="text-sm">Preparing preview…</p>
          )}
        </div>
      );
    }

    const type = meta.contentType;

    // PATH A — non-encrypted media: direct signed URL → native browser streaming
    if (directStreamUrl) {
      const isAudio = type.startsWith("audio/");
      return (
        <div className="h-full w-full bg-black flex items-center justify-center">
          <div className={isAudio ? "w-full p-4" : "aspect-video w-full"}>
            <Plyr
              source={{
                type: isAudio ? "audio" : "video",
                sources: [{ src: directStreamUrl, type }],
              }}
              options={{ autoplay: true }}
            />
          </div>
        </div>
      );
    }

    // PATH B — chunked encrypted media: MSE streaming
    if (chunkedOpts) {
      return (
        <ChunkedStreamPlayer 
          opts={chunkedOpts} 
          contentType={meta.contentType} 
          onUrlChange={() => {}} // No-op as modal handles state nicely
        />
      );
    }

    // PATH C — legacy / non-media: blob URL
    if (blobPreviewUrl) {
      if (type.startsWith("image/")) {
        return (
          <div className="grid h-full place-items-center bg-black/40 p-2 sm:p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={blobPreviewUrl}
              alt={meta.fileName}
              className="max-h-[calc(100dvh-8.5rem)] w-auto max-w-full object-contain"
            />
          </div>
        );
      }
      if (type.startsWith("video/") || type.startsWith("audio/")) {
        const isAudio = type.startsWith("audio/");
        return (
          <div className="h-full w-full bg-black flex items-center justify-center">
            <div className={isAudio ? "w-full p-4" : "aspect-video w-full"}>
              <Plyr
                source={{
                  type: isAudio ? "audio" : "video",
                  sources: [{ src: blobPreviewUrl, type }],
                }}
                options={{ autoplay: true }}
              />
            </div>
          </div>
        );
      }
      if (type === "application/pdf") {
        return (
          <div className="h-full w-full bg-white">
            <iframe
              src={blobPreviewUrl}
              className="h-full w-full border-0"
              title={meta.fileName}
            />
          </div>
        );
      }
      return (
        <div className="h-full w-full bg-white">
          <DocViewer
            documents={[{ uri: blobPreviewUrl, fileType: type }]}
            pluginRenderers={DocViewerRenderers}
            config={{
              header: {
                disableHeader: true,
                disableFileName: true,
                retainURLParams: true,
              },
              pdfVerticalScrollByDefault: true,
            }}
            style={{ height: "100%" }}
          />
        </div>
      );
    }

    return null;
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (error && !meta)
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center space-y-3">
            <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
            <p className="font-semibold text-foreground">{error}</p>
            <p className="text-sm text-muted-foreground">
              This link may have expired, been revoked, or never existed.
            </p>
          </CardContent>
        </Card>
      </div>
    );

  if (!meta)
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );

  const displayName = meta.fileName.split("/").pop() || meta.fileName;
  const canPreview =
    meta.contentType.startsWith("image/") ||
    meta.contentType.startsWith("video/") ||
    meta.contentType.startsWith("audio/") ||
    meta.contentType === "application/pdf";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            {meta.thumbnail ? (
              <img
                src={meta.thumbnail}
                alt={displayName}
                className="h-16 w-16 rounded-full object-cover"
              />
            ) : (
              <File className="h-8 w-8 text-primary" />
            )}
          </div>
          <CardTitle className="break-all text-lg text-foreground">
            {displayName}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {formatBytes(meta.size)}
          </p>
          {meta.isEncrypted && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-500 mt-1">
              <Lock className="h-3 w-3" /> End-to-End Encrypted
            </span>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {meta.expiresAt && (
            <p className="text-center text-xs text-muted-foreground">
              Expires {new Date(meta.expiresAt).toLocaleString()}
            </p>
          )}
          {meta.maxDownloads && (
            <p className="text-center text-xs text-muted-foreground">
              {meta.downloadCount} / {meta.maxDownloads} downloads used
            </p>
          )}

          {meta.isPasswordProtected && !done && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" /> Password
              </label>
              <Input
                type="password"
                placeholder="Enter password to access this file"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleDownload()}
                className="bg-secondary/50 border-border"
              />
            </div>
          )}

          {meta.isEncrypted && !shareKey && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-sm text-amber-500">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Decryption key missing</p>
                <p className="text-xs mt-0.5 text-amber-400/80">
                  The link is incomplete — ask the sender to reshare the full
                  link including the{" "}
                  <code className="bg-amber-500/20 px-1 rounded">#key=…</code>{" "}
                  at the end.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {done ? (
            <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-500">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> Downloaded
              successfully!
            </div>
          ) : (
            <div className="flex gap-2 w-full">
              {canPreview && (
                <Button
                  variant="secondary"
                  className="flex-1 bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  onClick={handlePreview}
                  disabled={
                    downloading ||
                    isFetchingForPreview ||
                    (meta.isPasswordProtected && !password) ||
                    (meta.isEncrypted && !shareKey)
                  }
                >
                  {isFetchingForPreview ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Eye className="mr-2 h-4 w-4" />
                  )}
                  Preview
                </Button>
              )}

              <Button
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={handleDownload}
                disabled={
                  downloading ||
                  (meta.isPasswordProtected && !password) ||
                  (meta.isEncrypted && !shareKey)
                }
              >
                {downloading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {meta.isEncrypted ? "Decrypting…" : "Downloading…"}
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" /> Download
                  </>
                )}
              </Button>
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Shared via{" "}
            <a
              href="/"
              className="underline hover:text-primary transition-colors"
            >
              Xenode Drive
            </a>
          </p>
        </CardContent>
      </Card>

      {/* Full Screen Preview Modal */}
      {isPreviewOpen && meta && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border bg-card/50">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                {meta.isEncrypted ? (
                  <Lock className="h-5 w-5 text-primary" />
                ) : (
                  <File className="h-5 w-5 text-primary" />
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {displayName}
                </h3>
                <p className="text-xs text-muted-foreground truncate max-w-[200px] sm:max-w-md">
                  {formatBytes(meta.size)} • {meta.contentType}
                  {chunkedOpts && (
                    <span className="ml-1 text-green-500">
                      • Streaming E2EE
                    </span>
                  )}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsPreviewOpen(false)}
            >
              <X className="h-6 w-6" />
            </Button>
          </div>
          <div className="flex-1 overflow-hidden relative">
            {renderPreview()}
          </div>
        </div>
      )}
    </div>
  );
}

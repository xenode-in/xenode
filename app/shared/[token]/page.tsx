"use client";
import { useState, useEffect, useRef } from "react";
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
} from "lucide-react";
import { getFileIcon } from "@/lib/file-icons";
import { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import dynamic from "next/dynamic";
import "plyr-react/plyr.css";
import { useVideoStream, VideoStreamOptions } from "@/hooks/useVideoStream";
import { getCachedResponse, storeCachedStream } from "@/lib/cache/previewCache";
import {
  decryptWithShareKey,
  decryptThumbnail,
} from "@/lib/crypto/fileEncryption";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useThumbnail } from "@/hooks/useThumbnail";

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
  shareEncryptedName?: string;
  shareEncryptedContentType?: string;
  mediaCategory?: string;
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
  chunkIvs?: string;
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
    true,
    ["decrypt"],
  );
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
  const [videoElement, setVideoElement] = useState<HTMLMediaElement | null>(
    null,
  );
  const { blobUrl, error, isBuffering, progress } = useVideoStream(
    opts,
    videoElement,
  );

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
    <div
      className={cn(
        "relative flex h-full items-center justify-center",
        isAudio ? "w-full p-4" : "w-full bg-black",
      )}
    >
      {isBuffering && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
          {progress > 0 && progress < 100 && (
            <>
              <div className="w-48 h-1.5 rounded-full bg-white/20 overflow-hidden">
                <div
                  className="h-full bg-white rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-white/70">Buffering {progress}%</p>
            </>
          )}
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

function SharedMediaPlayer({ url, type }: { url: string; type: string }) {
  const isAudio = type.startsWith("audio/");
  const [isWaiting, setIsWaiting] = useState(true);
  const plyrContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = plyrContainerRef.current;
    if (!el) return;
    let media: HTMLMediaElement | null = null;
    let disposed = false;
    const onPlaying = () => setIsWaiting(false);
    const onWaiting = () => setIsWaiting(true);
    const attach = (m: HTMLMediaElement) => {
      media = m;
      m.addEventListener("playing", onPlaying);
      m.addEventListener("waiting", onWaiting);
      if (m.readyState >= 3) setIsWaiting(false);
    };
    const interval = setInterval(() => {
      if (disposed) return;
      const found = el.querySelector("video, audio") as HTMLMediaElement | null;
      if (found) {
        clearInterval(interval);
        attach(found);
      }
    }, 100);
    return () => {
      disposed = true;
      clearInterval(interval);
      if (media) {
        media.removeEventListener("playing", onPlaying);
        media.removeEventListener("waiting", onWaiting);
      }
    };
  }, [url]);

  return (
    <div className="h-full w-full bg-black flex items-center justify-center">
      <div
        className={cn(
          "relative",
          isAudio ? "w-full p-4" : "aspect-video w-full",
        )}
      >
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm gap-3 transition-opacity duration-300"
          style={{
            opacity: isWaiting ? 1 : 0,
            pointerEvents: isWaiting ? "auto" : "none",
          }}
        >
          <Loader2 className="h-8 w-8 animate-spin text-white" />
          <p className="text-xs text-white/70">Buffering…</p>
        </div>
        <div ref={plyrContainerRef}>
          <Plyr
            source={{
              type: isAudio ? "audio" : "video",
              sources: [{ src: url, type }],
            }}
            options={{ autoplay: true }}
          />
        </div>
      </div>
    </div>
  );
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
  const [shareKey, setShareKey] = useState("");
  const [shareKeyObj, setShareKeyObj] = useState<CryptoKey | null>(null);

  const decryptedThumbnailUrl = useThumbnail(meta?.thumbnail, shareKeyObj);

  // Preview state
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isFetchingForPreview, setIsFetchingForPreview] = useState(false);
  const [fetchProgress, setFetchProgress] = useState(0);

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
          if (d.shareEncryptedName && shareKey) {
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
              const name = await decryptWithShareKey(
                d.shareEncryptedName,
                shareKeyObj,
              );
              setDecryptedName(name);

              if (d.shareEncryptedContentType) {
                const type = await decryptWithShareKey(
                  d.shareEncryptedContentType,
                  shareKeyObj,
                );
                setDecryptedContentType(type);
              }
            } catch (err) {
              console.error("Failed to decrypt shared file metadata", err);
            }
          }
        }
      } catch (err) {
        setError("Failed to load share info");
      }
    };

    loadData();
  }, [token, shareKey]);

  // Preview Paths
  const [directStreamUrl, setDirectStreamUrl] = useState<string | null>(null);
  const [chunkedOpts, setChunkedOpts] = useState<VideoStreamOptions | null>(
    null,
  );
  const [blobPreviewUrl, setBlobPreviewUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  // Sync shareKey from URL hash
  useEffect(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash;
      if (hash.startsWith("#key=")) {
        setShareKey(hash.replace("#key=", ""));
      }
    }
  }, []);

  // SW Registration
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  async function handlePreview() {
    if (!meta) return;
    setIsPreviewOpen(true);
    if (directStreamUrl || chunkedOpts || blobPreviewUrl) return;

    setError(null);
    const isMedia =
      (decryptedContentType || meta.contentType).startsWith("video/") ||
      (decryptedContentType || meta.contentType).startsWith("audio/");

    try {
      setIsFetchingForPreview(true);
      setFetchProgress(0);

      const res = await fetch(`/api/share/${token}/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Path A: Plain media
      if (isMedia && !data.isEncrypted && data.streamUrl) {
        setDirectStreamUrl(data.streamUrl);
        setIsFetchingForPreview(false);
        return;
      }

      if (data.isEncrypted && (!shareKey || !meta.shareEncryptedDEK)) {
        throw new Error("Missing decryption key in URL.");
      }

      let dek: CryptoKey | undefined;
      if (data.isEncrypted && meta.shareEncryptedDEK && meta.shareKeyIv) {
        dek = await deriveDek(
          shareKey,
          meta.shareEncryptedDEK,
          meta.shareKeyIv,
        );
      }

      // Path B: Chunked encrypted media
      if (isMedia && data.isEncrypted && dek && data.chunkUrls) {
        const chunkIvsArr = JSON.parse(data.chunkIvs);
        const rawDEK = await crypto.subtle.exportKey("raw", dek);

        if ("serviceWorker" in navigator) {
          try {
            const registration = await navigator.serviceWorker.ready;
            const sw = registration.active;
            if (sw) {
              await new Promise<void>((resolve, reject) => {
                const channel = new MessageChannel();
                channel.port1.onmessage = (e) =>
                  e.data.success ? resolve() : reject();
                sw.postMessage(
                  {
                    type: "REGISTER_STREAM",
                    fileId: token,
                    rawDEK,
                    chunkSize: data.chunkSize,
                    chunkCount: data.chunkCount,
                    chunkIvs: chunkIvsArr,
                    urls: data.chunkUrls,
                    contentType: data.contentType,
                    size: meta.size,
                  },
                  [channel.port2],
                );
              });
              setDirectStreamUrl(`/sw/objects/${token}`);
              setIsFetchingForPreview(false);
              return;
            }
          } catch {}
        }

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

      // Path C: Blob preview
      if (!data.streamUrl) throw new Error("Stream URL missing");
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
        blob = new Blob([decrypted], {
          type: decryptedContentType || data.contentType,
        });
      } else {
        blob = new Blob([raw], {
          type: decryptedContentType || data.contentType,
        });
      }
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setBlobPreviewUrl(url);
    } catch (e: any) {
      setError(e.message || "Preview failed");
      setIsPreviewOpen(false);
    } finally {
      setIsFetchingForPreview(false);
    }
  }

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
        throw new Error("Missing decryption key.");
      }

      let dek: CryptoKey | undefined;
      if (data.isEncrypted && meta.shareEncryptedDEK && meta.shareKeyIv) {
        dek = await deriveDek(
          shareKey,
          meta.shareEncryptedDEK,
          meta.shareKeyIv,
        );
      }

      let blob: Blob;
      if (data.isEncrypted && dek) {
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
            type: decryptedContentType || data.contentType,
          });
        } else {
          const raw = await fetchWithProgress(
            data.downloadUrl,
            setDownloadProgress,
            undefined,
            meta.size,
          );
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
          blob = new Blob([decrypted], {
            type: decryptedContentType || data.contentType,
          });
        }
      } else {
        const raw = await fetchWithProgress(
          data.downloadUrl,
          setDownloadProgress,
          undefined,
          meta.size,
        );
        blob = new Blob([raw], {
          type: decryptedContentType || data.contentType,
        });
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        decryptedName || data.fileName || meta.fileName || "download";
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch (e: any) {
      setError(e.message || "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  if (error && !meta)
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center space-y-3">
            <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
            <p className="font-semibold text-foreground">{error}</p>
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

  const displayName =
    decryptedName ||
    (meta.fileName ? meta.fileName.split("/").pop() : "File") ||
    "File";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 overflow-hidden">
            {decryptedThumbnailUrl ? (
              <img
                src={decryptedThumbnailUrl}
                alt={displayName}
                className="h-16 w-16 object-cover"
              />
            ) : (
              getFileIcon(decryptedContentType || meta.contentType, "h-8 w-8", meta.mediaCategory)
            )}
          </div>
          <CardTitle className="break-all text-lg">{displayName}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {formatBytes(meta.size)}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {meta.isPasswordProtected && !done && (
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
          <Button
            className="w-full"
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading ? `Downloading ${downloadProgress}%` : "Download"}
          </Button>
          <Button variant="outline" className="w-full" onClick={handlePreview}>
            Preview
          </Button>
        </CardContent>
      </Card>

      {/* Preview Modal */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="relative w-full max-w-4xl h-[80vh] bg-card rounded-xl overflow-hidden shadow-2xl">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 z-10 text-white hover:bg-white/20"
              onClick={() => setIsPreviewOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>

            {isFetchingForPreview ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-white">
                <Loader2 className="h-10 w-10 animate-spin" />
                <p>Preparing preview {fetchProgress}%</p>
              </div>
            ) : (
              <div className="h-full w-full">
                {directStreamUrl ? (
                  <SharedMediaPlayer
                    url={directStreamUrl}
                    type={decryptedContentType || meta.contentType}
                  />
                ) : chunkedOpts ? (
                  <ChunkedStreamPlayer
                    opts={chunkedOpts}
                    contentType={decryptedContentType || meta.contentType}
                    onUrlChange={() => {}}
                  />
                ) : blobPreviewUrl ? (
                  (decryptedContentType || meta.contentType).startsWith(
                    "image/",
                  ) ? (
                    <div className="flex h-full items-center justify-center bg-black">
                      <img
                        src={blobPreviewUrl}
                        alt={displayName}
                        className="max-h-full"
                      />
                    </div>
                  ) : (decryptedContentType || meta.contentType) ===
                    "application/pdf" ? (
                    <iframe
                      src={blobPreviewUrl}
                      className="w-full h-full border-0"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center p-8">
                      <p>Preview not supported for this file type.</p>
                    </div>
                  )
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

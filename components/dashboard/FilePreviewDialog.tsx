"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  Dialog,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogOverlay,
  DialogPortal,
} from "@/components/ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  AlertCircle,
  X,
  Lock,
  Minimize2,
  Maximize2,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { Plyr } from "plyr-react";
import "plyr-react/plyr.css";

import DocViewer, { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import { useCrypto } from "@/contexts/CryptoContext";
import {
  decryptFile,
  decryptFileChunkedCombined,
  decryptFileName,
} from "@/lib/crypto/fileEncryption";
import { fromB64 } from "@/lib/crypto/utils";
import { getCachedResponse, storeCachedStream } from "@/lib/cache/previewCache";
import { useVideoStream, VideoStreamOptions } from "@/hooks/useVideoStream";

interface ObjectData {
  id: string;
  key: string;
  size: number;
  contentType: string;
  createdAt: string;
  isEncrypted?: boolean;
  encryptedName?: string;
  name?: string;
}

interface FilePreviewDialogProps {
  file: ObjectData | null;
  isOpen: boolean;
  onClose: () => void;
}

const ChunkedStreamPlayer = ({
  opts,
  type,
  onUrlChange,
  onReady,
}: {
  opts: VideoStreamOptions;
  type: string;
  onUrlChange: (url: string | null) => void;
  onReady?: () => void;
}) => {
  const isAudio = type.startsWith("audio/");
  const [videoElement, setVideoElement] = useState<HTMLMediaElement | null>(null);

  const { blobUrl, error, isBuffering, progress } = useVideoStream(opts, videoElement);

  useEffect(() => {
    onUrlChange(blobUrl);
    return () => onUrlChange(null);
  }, [blobUrl, onUrlChange]);

  useEffect(() => {
    if (error && onReady) {
      onReady();
    }
  }, [error, onReady]);

  if (error) {
    if (onReady) onReady();
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <AlertCircle className="mb-2 h-8 w-8 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn("relative flex h-full items-center justify-center", isAudio ? "w-full p-4" : "w-full bg-black")}>
      {isBuffering && !videoElement?.readyState && (
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
      
      {/* We use a native video element directly for MediaSource stability */}
      {isAudio ? (
        <audio
          ref={(node) => setVideoElement(node)}
          controls
          autoPlay
          className="w-full"
          src={blobUrl || ""}
          onCanPlay={onReady}
          onPlaying={onReady}
        />
      ) : (
        <video
          ref={(node) => setVideoElement(node)}
          controls
          autoPlay
          playsInline
          className="max-h-full max-w-full"
          src={blobUrl || ""}
          onCanPlay={onReady}
          onPlaying={onReady}
        />
      )}
    </div>
  );
};

const MediaPlayer = ({ url, type, onReady }: { url: string; type: string; onReady?: () => void }) => {
  const isAudio = type.startsWith("audio/");
  const [isWaiting, setIsWaiting] = useState(true);
  const plyrContainerRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Poll for Plyr's <video>/<audio> element then attach buffering events
  useEffect(() => {
    const el = plyrContainerRef.current;
    if (!el) return;

    let media: HTMLMediaElement | null = null;
    let disposed = false;

    const onCanPlay = () => { setIsWaiting(false); onReadyRef.current?.(); };
    const onPlaying = () => { setIsWaiting(false); onReadyRef.current?.(); };
    const onWaiting = () => setIsWaiting(true);

    const attach = (m: HTMLMediaElement) => {
      media = m;
      m.addEventListener("canplay", onCanPlay);
      m.addEventListener("playing", onPlaying);
      m.addEventListener("waiting", onWaiting);
      if (m.readyState >= 3) { setIsWaiting(false); onReadyRef.current?.(); }
    };

    // Plyr creates the element asynchronously — poll until it appears
    const interval = setInterval(() => {
      if (disposed) return;
      const found = el.querySelector("video, audio") as HTMLMediaElement | null;
      if (found) { clearInterval(interval); attach(found); }
    }, 100);

    return () => {
      disposed = true;
      clearInterval(interval);
      if (media) {
        media.removeEventListener("canplay", onCanPlay);
        media.removeEventListener("playing", onPlaying);
        media.removeEventListener("waiting", onWaiting);
      }
    };
  }, [url]);

  return (
    <div className={cn("relative", isAudio ? "w-full p-4" : "w-full")}>
      {/* Overlay — always in DOM, toggled via CSS to avoid React/Plyr DOM conflicts */}
      <div
        className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm gap-3 transition-opacity duration-300"
        style={{ opacity: isWaiting ? 1 : 0, pointerEvents: isWaiting ? "auto" : "none" }}
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
  );
};

const MemoizedMediaPlayer = React.memo(MediaPlayer);

function fileNameFromKey(key: string) {
  const part = key.split("/").pop();
  return part || key;
}

function formatMB(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2);
}

/** Fetch a URL while invoking onProgress(0-100) as bytes arrive and caching the stream locally */
async function fetchWithProgress(
  url: string,
  onProgress?: (pct: number) => void,
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

  if (fromCache && onProgress) {
    onProgress(100); // instant jump
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total > 0 && !fromCache && onProgress) {
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

export function FilePreviewDialog({
  file,
  isOpen,
  onClose,
}: FilePreviewDialogProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [streamOpts, setStreamOpts] = useState<VideoStreamOptions | null>(null);
  const [loadingMessage, setLoadingMessage] = useState<string>("Loading preview...");
  const [progress, setProgress] = useState<number | null>(null);
  const [isVideoPreparing, setIsVideoPreparing] = useState(false);
  const [decryptedName, setDecryptedName] = useState<string | null>(null);

  // Track object URLs we created so we can revoke them on close
  const objectUrlRef = useRef<string | null>(null);

  const { privateKey, setModalOpen, isUnlocked } = useCrypto();

  const isLockedOut = file?.isEncrypted && !privateKey;

  // If locked out, prevent dialog from opening, trigger modal, and close preview
  useEffect(() => {
    if (isOpen && isLockedOut) {
      setModalOpen(true);
      onClose();
    }
  }, [isOpen, isLockedOut, setModalOpen, onClose]);

  // Pre-register the SW on mount so it's already active when a file is opened
  // — eliminates ~200-500ms activation delay.
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Revoke any object URL when the dialog closes or file changes
  useEffect(() => {
    if (!isOpen) {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setUrl(null);
      setError("");
      setIsEncrypted(false);
      setIsMinimized(false);
      setStreamOpts(null);
      setLoadingMessage("Loading preview...");
      setProgress(null);
      setIsVideoPreparing(false);
      setDecryptedName(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!file || !isUnlocked || !file.isEncrypted || !file.encryptedName) {
      return;
    }
    
    let cancelled = false;

    async function decryptName() {
      try {
        const name = file!.name || await decryptFileName(file!.encryptedName!);
        if (!cancelled) setDecryptedName(name);
      } catch (e) {
        console.error("Failed to decrypt preview file name", e);
      }
    }

    decryptName();

    return () => {
      cancelled = true;
    };
  }, [file, isUnlocked]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // Don't run the fetch if we are locked out (prevents unnecessary network requests)
      if (!isOpen || !file || isLockedOut) return;

      setLoading(true);
      setLoadingMessage("Fetching metadata...");
      setError("");
      setUrl(null);
      setStreamOpts(null);
      setProgress(null);
      setIsVideoPreparing(false);

      try {
        // 1. Fetch metadata + signed URL from our API
        const res = await fetch(`/api/objects/${file.id}`);
        if (!res.ok) throw new Error("Failed to get URL");
        const data = await res.json();
        if (!data?.url && (!data?.chunkUrls || data.chunkUrls.length === 0)) throw new Error("No URL returned");

        const encrypted: boolean = data.isEncrypted ?? false;

        const type = data.contentType ?? file.contentType;
        const shouldShowPreparingUI = type.startsWith("video/") || type.startsWith("audio/") || type.startsWith("image/") || type === "application/pdf";

        if (!encrypted) {
          if (data.chunkUrls && data.chunkUrls.length > 0) {
            if (!cancelled) {
              // Not encrypted but chunked. We should just set streamOpts with null dek 
              // and handle it in useVideoStream.
              setStreamOpts({
                urls: data.chunkUrls,
                dek: null,
                chunkSize: data.chunkSize || (2 * 1024 * 1024),
                chunkCount: data.chunkCount || data.chunkUrls.length,
                chunkIvs: [],
                contentType: data.contentType ?? file.contentType,
              });
              setLoadingMessage("Fetching initial chunks...");
              if (shouldShowPreparingUI) setIsVideoPreparing(true);
              setLoading(false);
            }
          } else {
            // Legacy plaintext file — use the signed URL directly
            if (!cancelled) {
              setUrl(data.url || "");
              setIsEncrypted(false);
            }
          }
          return;
        }


        // 2. Encrypted file — need private key to decrypt
        setIsEncrypted(true);

        if (!privateKey) {
          setModalOpen(true);
          throw new Error(
            "Your files are encrypted. Please unlock your vault to preview this file.",
          );
        }

        if (data.chunkUrls && data.chunkUrls.length > 0) {
          // 3a. New Multi-object streaming
          setLoadingMessage("Preparing decryption...");
          if (!data.encryptedDEK) {
            throw new Error("Missing encrypted DEK for chunked file.");
          }
          
          if (!cancelled) {
            const rawDEK = await crypto.subtle.decrypt(
              { name: "RSA-OAEP" },
              privateKey,
              fromB64(data.encryptedDEK)
            );
          
            if ("serviceWorker" in navigator) {
              try {
                setLoadingMessage("Preparing stream...");
                // SW was pre-registered on mount — just wait for it to be ready
                const registration = await navigator.serviceWorker.ready;
                const sw = registration.active;
                
                if (sw) {
                  await new Promise<void>((resolve, reject) => {
                    const channel = new MessageChannel();
                    channel.port1.onmessage = (event) => {
                      if (event.data.success) resolve();
                      else reject(new Error("Failed to register stream with SW"));
                    };
                    sw.postMessage({
                      type: "REGISTER_STREAM",
                      fileId: file.id,
                      rawDEK,
                      chunkSize: data.chunkSize || 2 * 1024 * 1024,
                      chunkCount: data.chunkCount || data.chunkUrls.length,
                      chunkIvs: data.chunkIvs ? JSON.parse(data.chunkIvs) : [],
                      urls: data.chunkUrls,
                      contentType: data.contentType ?? file.contentType,
                      size: file.size,
                    }, [channel.port2]);
                  });

                  if (!cancelled) {
                    setLoadingMessage("Fetching initial chunks...");
                    if (shouldShowPreparingUI) setIsVideoPreparing(true);
                    setUrl(`/sw/objects/${file.id}`);
                    setLoading(false);
                    return;
                  }
                }
              } catch (err) {
                console.error("SW streaming failed, falling back to MSE", err);
              }
            }

            const dek = await crypto.subtle.importKey(
              "raw",
              rawDEK,
              { name: "AES-GCM", length: 256 },
              false,
              ["decrypt"]
            );

            setStreamOpts({
              urls: data.chunkUrls,
              dek,
              chunkSize: data.chunkSize || (2 * 1024 * 1024),
              chunkCount: data.chunkCount || data.chunkUrls.length,
              chunkIvs: data.chunkIvs ? JSON.parse(data.chunkIvs) : [],
              contentType: data.contentType ?? file.contentType,
            });
            if (shouldShowPreparingUI) setIsVideoPreparing(true);
            setLoadingMessage("Fetching initial chunks...");
            setLoading(false);
          }
          return;
        }

        // 3. Fetch raw ciphertext directly from CDN
        // Added Cache Storage check (fetchWithProgress) so previously decrypted files load instantly
        setLoadingMessage(encrypted ? "Downloading encrypted file..." : "Downloading file...");
        const ciphertextBuf = await fetchWithProgress(
          data.url, // Directly fetch from CDN URL instead of via /content proxy
          (pct) => {
            if (!cancelled) setProgress(pct);
          },
          file.id, // Using the file.id as the cache key
          file.size, // using file.size to enforce the 500MB bypass limit limit
        );

        if (!cancelled) {
          setProgress(null);
          setLoadingMessage("Decrypting file...");
        }

        let decryptedBlob: Blob;

        if (data.chunkIvs && data.chunkSize && data.chunkCount) {
          // 4a. Decrypt Chunked payload
          if (!data.encryptedDEK) {
            throw new Error(
              "Missing encrypted DEK for chunked file. File might be corrupted.",
            );
          }
          decryptedBlob = await decryptFileChunkedCombined(
            ciphertextBuf,
            data.encryptedDEK,
            data.chunkIvs,
            data.chunkSize,
            data.chunkCount,
            privateKey,
            data.contentType ?? file.contentType,
          );
        } else {
          // 4b. Decrypt standard singular payload
          if (!data.iv || !data.encryptedDEK) {
            throw new Error(
              "Missing encryption parameters (IV or DEK). File might be corrupted.",
            );
          }
          decryptedBlob = await decryptFile(
            ciphertextBuf,
            data.encryptedDEK,
            data.iv,
            privateKey,
            data.contentType ?? file.contentType,
          );
        }

        // 5. Create object URL from decrypted blob
        const objectUrl = URL.createObjectURL(decryptedBlob);
        objectUrlRef.current = objectUrl;

        if (!cancelled) setUrl(objectUrl);
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : "Failed to load preview. Please try downloading instead.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, file, privateKey, isLockedOut, setModalOpen]);

  const docs = useMemo(() => {
    if (!url || !file) return [];
    return [{ uri: url, fileType: file.contentType }];
  }, [url, file]);

  if (!file) return null;

  const name = file.name || decryptedName || fileNameFromKey(file.key);
  const type = file.contentType;

  // Download handler: for encrypted files, trigger programmatic download
  // from the decrypted Blob URL instead of opening the ciphertext URL.
  const handleDownload = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  };

  const renderContent = () => {
    let innerContent = null;

    if (!loading && !error) {
      if (streamOpts) {
        innerContent = (
          <ChunkedStreamPlayer
            opts={streamOpts}
            type={type}
            onUrlChange={(newUrl) => {
              if (newUrl !== url) setUrl(newUrl);
            }}
            onReady={() => setIsVideoPreparing(false)}
          />
        );
      } else if (url) {
        if (type.startsWith("image/")) {
          innerContent = (
            <div className="grid h-full place-items-center bg-black/40 p-2 sm:p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={name}
                className="max-h-[calc(100dvh-8.5rem)] w-auto max-w-full object-contain"
                onLoad={() => setIsVideoPreparing(false)}
                onError={() => setIsVideoPreparing(false)}
              />
            </div>
          );
        } else if (type.startsWith("video/") || type.startsWith("audio/")) {
          innerContent = (
            <div className="h-full w-full bg-black flex items-center justify-center flex-col">
              <div className={type.startsWith("video/") ? "aspect-video" : "py-4"}>
                <MemoizedMediaPlayer url={url} type={type} onReady={() => setIsVideoPreparing(false)} />
              </div>
            </div>
          );
        } else if (type === "application/pdf") {
          innerContent = (
            <div className="h-full w-full bg-white">
              <iframe 
                src={url} 
                className="h-full w-full border-0" 
                title={name} 
                onLoad={() => setIsVideoPreparing(false)}
                onError={() => setIsVideoPreparing(false)}
              />
            </div>
          );
        } else {
          // Other docs (DocViewer)
          innerContent = (
            <div className="h-full w-full bg-white">
              <DocViewer
                documents={docs}
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
      }
    }

    const showLoader = loading || isVideoPreparing;

    return (
      <div className="relative h-full w-full">
        {showLoader && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
            <div className="flex flex-col items-center w-full max-w-[200px] text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
              <p className="text-sm font-medium text-foreground">
                {loadingMessage}
              </p>
              {progress !== null && (
                <div className="w-full mt-3 flex flex-col items-center">
                  <Progress value={progress} className="h-1.5 w-full" />
                  <p className="text-xs text-muted-foreground mt-1.5">{progress}%</p>
                </div>
              )}
            </div>
          </div>
        )}

        {error ? (
          <div className="grid h-full min-h-[40vh] place-items-center px-6 text-center">
            <div className="flex flex-col items-center">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="mt-3 text-sm text-destructive">{error}</p>
              <div className="mt-5 flex gap-2">
                <DialogClose asChild>
                  <Button variant="secondary">Close</Button>
                </DialogClose>
              </div>
            </div>
          </div>
        ) : (
          innerContent
        )}
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose} modal={false}>
      <DialogPortal>
        <DialogOverlay className={isMinimized ? "hidden" : ""} />
        <DialogPrimitive.Content
          onInteractOutside={(e) => {
            if (isMinimized) {
              e.preventDefault();
            }
          }}
          className={cn(
            "bg-card outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 flex flex-col overflow-hidden border",
            isMinimized
              ? "fixed bottom-4 right-4 z-150 w-80 sm:w-96 rounded-xl shadow-2xl data-[state=open]:slide-in-from-bottom-[20%]"
              : "fixed inset-0 sm:top-[50%] sm:left-[50%] z-150 w-full max-w-full sm:max-w-5xl lg:max-w-6xl h-dvh sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:translate-x-[-50%] sm:translate-y-[-50%] rounded-none sm:rounded-xl shadow-lg data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          {/* Top bar */}
          <div
            className={cn(
              "sticky top-0 z-20 flex items-center justify-between gap-3 border-b bg-card/95 backdrop-blur",
              isMinimized ? "px-3 py-2" : "px-4 py-3 sm:px-5",
            )}
          >
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title
                className={cn(
                  "truncate font-medium flex items-center gap-1.5",
                  isMinimized ? "text-xs" : "text-sm sm:text-base",
                )}
              >
                {isEncrypted && (
                  <Lock
                    className={cn(
                      "shrink-0 text-primary",
                      isMinimized ? "h-3 w-3" : "h-3.5 w-3.5",
                    )}
                    aria-label="Encrypted"
                  />
                )}
                {name}
              </DialogPrimitive.Title>
              {!isMinimized && (
                <DialogPrimitive.Description className="truncate text-xs text-muted-foreground mt-0.5">
                  {formatMB(file.size)} MB • {file.contentType}
                  {isEncrypted && " • e2e encrypted"}
                </DialogPrimitive.Description>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {url && !isMinimized && !streamOpts && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  className="mr-1"
                >
                  Download
                </Button>
              )}

              <Button
                variant="ghost"
                size="icon"
                className={isMinimized ? "h-6 w-6" : "h-8 w-8"}
                aria-label="Toggle Minimize"
                onClick={() => setIsMinimized((prev) => !prev)}
              >
                {isMinimized ? (
                  <Maximize2 className="h-4 w-4" />
                ) : (
                  <Minimize2 className="h-4 w-4" />
                )}
              </Button>

              <DialogClose asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close"
                  className={isMinimized ? "h-6 w-6" : "h-8 w-8"}
                >
                  <X className="h-4 w-4" />
                </Button>
              </DialogClose>
            </div>
          </div>

          {/* Preview area */}
          <div
            className={cn(
              "overflow-hidden bg-black/5 dark:bg-black/20",
              isMinimized ? "h-48" : "flex-1",
            )}
          >
            <div className="h-full w-full">{renderContent()}</div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

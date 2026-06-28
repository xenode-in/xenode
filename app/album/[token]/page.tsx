"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, AlertCircle, Lock, ImageOff, Download } from "lucide-react";

import { Navbar } from "@/components/Navbar";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FilePreviewDialog } from "@/components/dashboard/FilePreviewDialog";
import {
  decryptWithShareKey,
  decryptChunk,
  decryptFileWithDEK,
} from "@/lib/crypto/fileEncryption";
import { fromB64 } from "@/lib/crypto/utils";

interface ManifestItem {
  objectId: string;
  size: number;
  mediaCategory: string;
  aspectRatio: number;
  isEncrypted: boolean;
  contentType: string;
  shareEncryptedName: string | null;
  shareEncryptedContentType: string | null;
  shareEncryptedDEK: string;
  shareKeyIv: string;
  thumbnailUrl: string | null;
}

interface DecoratedItem extends ManifestItem {
  name: string;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(s.length + ((4 - (s.length % 4)) % 4), "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="grow">{children}</main>
      <LandingFooter />
    </div>
  );
}

function ThumbnailTile({
  item,
  shareKey,
  onClick,
}: {
  item: DecoratedItem;
  shareKey: CryptoKey | null;
  onClick: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!item.thumbnailUrl || !shareKey) {
      setFailed(true);
      return;
    }
    (async () => {
      try {
        const text = await (await fetch(item.thumbnailUrl!)).text();
        const dataUrl = await decryptWithShareKey(text, shareKey);
        if (!cancelled) setSrc(dataUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.thumbnailUrl, shareKey]);

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative aspect-square overflow-hidden rounded-xl bg-secondary border border-border/50 group"
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={item.name}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : failed ? (
        <div className="flex h-full w-full items-center justify-center">
          <ImageOff className="h-7 w-7 text-muted-foreground/40" />
        </div>
      ) : (
        <div className="h-full w-full animate-pulse bg-secondary" />
      )}
    </button>
  );
}

export default function SharedAlbumPage() {
  const { token } = useParams<{ token: string }>();

  const [shareKeyStr, setShareKeyStr] = useState("");
  const [shareKey, setShareKey] = useState<CryptoKey | null>(null);
  const [keyMissing, setKeyMissing] = useState(false);

  const [albumName, setAlbumName] = useState("Shared album");
  const [items, setItems] = useState<DecoratedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadAllProgress, setDownloadAllProgress] = useState(0);

  // Read the share key from the URL fragment.
  useEffect(() => {
    const read = () => {
      const hash = window.location.hash;
      if (hash.startsWith("#key=")) {
        setShareKeyStr(hash.slice(5));
        setKeyMissing(false);
      } else {
        setKeyMissing(true);
      }
    };
    read();
    window.addEventListener("hashchange", read);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    return () => window.removeEventListener("hashchange", read);
  }, []);

  // Import the share key.
  useEffect(() => {
    if (!shareKeyStr) return;
    (async () => {
      try {
        const raw = b64urlToBytes(shareKeyStr);
        const key = await crypto.subtle.importKey(
          "raw",
          raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
          { name: "AES-GCM" },
          false,
          ["decrypt", "unwrapKey"],
        );
        setShareKey(key);
      } catch {
        setError("Invalid decryption key in link.");
      }
    })();
  }, [shareKeyStr]);

  const loadManifest = useCallback(
    async (pwd?: string) => {
      const res = await fetch(`/api/album-share/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        const err = new Error(data.error || "Failed to load album");
        (err as Error & { status?: number }).status = res.status;
        throw err;
      }
      return data as {
        shareEncryptedAlbumName: string | null;
        items: ManifestItem[];
      };
    },
    [token],
  );

  // Initial metadata + (for non-protected links) manifest load.
  useEffect(() => {
    if (!shareKey || !token) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const metaRes = await fetch(`/api/album-share/${token}`);
        const meta = await metaRes.json();
        if (!metaRes.ok) throw new Error(meta.error || "Album not found");

        if (meta.isPasswordProtected) {
          if (!cancelled) {
            setNeedsPassword(true);
            setLoading(false);
            if (meta.shareEncryptedAlbumName) {
              try {
                setAlbumName(
                  await decryptWithShareKey(meta.shareEncryptedAlbumName, shareKey),
                );
              } catch {
                /* keep default */
              }
            }
          }
          return;
        }

        const data = await loadManifest();
        if (cancelled) return;
        await applyManifest(data);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareKey, token]);

  async function applyManifest(data: {
    shareEncryptedAlbumName: string | null;
    items: ManifestItem[];
  }) {
    if (!shareKey) return;
    if (data.shareEncryptedAlbumName) {
      try {
        setAlbumName(await decryptWithShareKey(data.shareEncryptedAlbumName, shareKey));
      } catch {
        /* keep default */
      }
    }
    const decorated = await Promise.all(
      data.items.map(async (it) => {
        let name = "Photo";
        if (it.shareEncryptedName) {
          try {
            name = await decryptWithShareKey(it.shareEncryptedName, shareKey);
          } catch {
            /* keep default */
          }
        }
        return { ...it, name };
      }),
    );
    setItems(decorated);
  }

  async function submitPassword() {
    setUnlocking(true);
    setError(null);
    try {
      const data = await loadManifest(password);
      await applyManifest(data);
      setNeedsPassword(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Incorrect password");
    } finally {
      setUnlocking(false);
    }
  }

  async function downloadAll() {
    if (!shareKey || items.length === 0 || downloadingAll) return;
    setDownloadingAll(true);
    setDownloadAllProgress(0);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const used = new Map<string, number>();

      const uniqueName = (name: string) => {
        const base = name || "photo";
        const seen = used.get(base) ?? 0;
        used.set(base, seen + 1);
        if (seen === 0) return base;
        const dot = base.lastIndexOf(".");
        return dot > 0
          ? `${base.slice(0, dot)} (${seen})${base.slice(dot)}`
          : `${base} (${seen})`;
      };

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        try {
          const res = await fetch(
            `/api/album-share/${token}/objects/${it.objectId}/stream`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password: password || undefined }),
            },
          );
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "stream failed");

          let blob: Blob;
          if (data.isEncrypted) {
            const dek = await crypto.subtle.unwrapKey(
              "raw",
              fromB64(data.shareEncryptedDEK).buffer as ArrayBuffer,
              shareKey,
              {
                name: "AES-GCM",
                iv: fromB64(data.shareKeyIv).buffer as ArrayBuffer,
              },
              { name: "AES-GCM" },
              false,
              ["decrypt"],
            );
            if (data.chunkUrls && data.chunkUrls.length > 0) {
              const ivs: string[] = JSON.parse(data.chunkIvs);
              const parts: ArrayBuffer[] = [];
              for (let c = 0; c < data.chunkUrls.length; c++) {
                parts.push(
                  await decryptChunk(
                    await (await fetch(data.chunkUrls[c])).arrayBuffer(),
                    dek,
                    ivs[c],
                  ),
                );
              }
              blob = new Blob(parts, { type: it.contentType });
            } else {
              const cipher = await (
                await fetch(data.url || data.streamUrl)
              ).arrayBuffer();
              blob = await decryptFileWithDEK(cipher, dek, data.iv, it.contentType);
            }
          } else {
            blob = await (await fetch(data.url || data.streamUrl)).blob();
          }
          zip.file(uniqueName(it.name), blob);
        } catch (e) {
          console.warn(`Skipping ${it.objectId} in download-all`, e);
        }
        setDownloadAllProgress(Math.round(((i + 1) / items.length) * 100));
      }

      const out = await zip.generateAsync({ type: "blob" });
      const objectUrl = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${albumName || "album"}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setDownloadingAll(false);
    }
  }

  const fileList = useMemo(
    () =>
      items.map((it) => ({
        id: it.objectId,
        key: "",
        size: it.size,
        contentType: it.contentType,
        isEncrypted: it.isEncrypted,
        name: it.name,
        mediaCategory: it.mediaCategory,
        createdAt: "",
      })),
    [items],
  );

  if (keyMissing) {
    return (
      <Shell>
        <div className="flex items-center justify-center p-8 min-h-[60vh]">
          <Card className="w-full max-w-md p-8 text-center">
            <Lock className="mx-auto h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h2 className="text-xl font-semibold">Missing decryption key</h2>
            <p className="text-sm text-muted-foreground mt-2">
              This album is end-to-end encrypted. The link must include its key
              to open it.
            </p>
          </Card>
        </div>
      </Shell>
    );
  }

  if (error && items.length === 0 && !needsPassword) {
    return (
      <Shell>
        <div className="flex items-center justify-center p-8 min-h-[60vh]">
          <Card className="w-full max-w-md p-8 text-center">
            <AlertCircle className="mx-auto h-12 w-12 text-destructive mb-4" />
            <p className="font-semibold text-lg">{error}</p>
          </Card>
        </div>
      </Shell>
    );
  }

  if (needsPassword) {
    return (
      <Shell>
        <div className="flex items-center justify-center p-8 min-h-[60vh]">
          <Card className="w-full max-w-md p-8 space-y-4">
            <div className="text-center">
              <Lock className="mx-auto h-10 w-10 text-primary mb-3" />
              <h2 className="text-xl font-semibold">{albumName}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                This album is password protected.
              </p>
            </div>
            <Input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitPassword()}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button
              className="w-full"
              onClick={submitPassword}
              disabled={unlocking || !password}
            >
              {unlocking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Unlock album"
              )}
            </Button>
          </Card>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{albumName}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {items.length} photo{items.length === 1 ? "" : "s"} • shared via
              Xenode
            </p>
          </div>
          {items.length > 0 && (
            <Button onClick={downloadAll} disabled={downloadingAll}>
              {downloadingAll ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Preparing… {downloadAllProgress}%
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Download all
                </>
              )}
            </Button>
          )}
        </header>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary opacity-50" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-20 text-center text-muted-foreground">
            This album is empty.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {items.map((item, idx) => (
              <ThumbnailTile
                key={item.objectId}
                item={item}
                shareKey={shareKey}
                onClick={() => setPreviewIndex(idx)}
              />
            ))}
          </div>
        )}
      </div>

      {previewIndex !== null && fileList[previewIndex] && (
        <FilePreviewDialog
          file={fileList[previewIndex]}
          isOpen={previewIndex !== null}
          onClose={() => setPreviewIndex(null)}
          albumShareToken={token}
          sharedToken={token}
          shareKey={shareKeyStr}
          password={password}
          hasNext={previewIndex < fileList.length - 1}
          hasPrevious={previewIndex > 0}
          onNext={() =>
            setPreviewIndex((i) =>
              i !== null && i < fileList.length - 1 ? i + 1 : i,
            )
          }
          onPrevious={() =>
            setPreviewIndex((i) => (i !== null && i > 0 ? i - 1 : i))
          }
        />
      )}
    </Shell>
  );
}

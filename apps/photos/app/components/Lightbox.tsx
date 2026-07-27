"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Play,
  X,
} from "lucide-react";
import { Button, cn } from "@xenode/ui";
import { useProductCrypto } from "@xenode/crypto-react";
import type { TimelineAsset } from "./Timeline";
import { decryptPhotoFile } from "@/lib/photo-encryption";
import {
  fetchCachedPhotoCiphertext,
  photoPreviewCacheKey,
} from "@/lib/photo-preview-cache";

type ContentVariant = "optimized" | "original";

type ContentDescriptor = {
  accountId?: string;
  contentType?: string;
  encryptedDEK?: string;
  error?: string;
  iv?: string;
  mediaType?: "image" | "video";
  objectKey?: string;
  spaceId?: string;
  spaceKeyWrapIv?: string;
  url?: string;
  variant?: ContentVariant | "thumbnail";
};

export function Lightbox({
  asset,
  assets = [],
  onChange,
  onClose,
}: {
  asset: TimelineAsset | null;
  assets?: TimelineAsset[];
  onChange?(asset: TimelineAsset): void;
  onClose(): void;
}) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const currentIndex = asset
    ? assets.findIndex((candidate) => candidate.id === asset.id)
    : -1;
  const previous =
    currentIndex > 0 ? assets[currentIndex - 1] : undefined;
  const next =
    currentIndex >= 0 && currentIndex < assets.length - 1
      ? assets[currentIndex + 1]
      : undefined;

  const selectPrevious = useCallback(() => {
    if (previous) onChange?.(previous);
  }, [onChange, previous]);
  const selectNext = useCallback(() => {
    if (next) onChange?.(next);
  }, [next, onChange]);
  const closePreview = useCallback(() => {
    setIsMinimized(false);
    setShowInfo(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!asset || isMinimized) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePreview();
      } else if (event.key === "ArrowLeft" && previous) {
        event.preventDefault();
        selectPrevious();
      } else if (event.key === "ArrowRight" && next) {
        event.preventDefault();
        selectNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [asset, closePreview, isMinimized, next, previous, selectNext, selectPrevious]);

  if (!asset) return null;

  const title = `${asset.mediaType === "video" ? "Video" : "Photo"} · ${new Date(
    asset.takenAt,
  ).toLocaleDateString()}`;

  return (
    <div
      role="dialog"
      aria-modal={!isMinimized}
      aria-label="Photo preview"
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden border bg-card text-card-foreground shadow-2xl",
        isMinimized
          ? "bottom-4 right-4 h-72 w-[min(24rem,calc(100vw-2rem))] rounded-xl"
          : "inset-0 h-dvh w-screen",
      )}
    >
      <header
        className={cn(
          "z-20 flex items-center justify-between gap-3 border-b bg-card/95 backdrop-blur",
          isMinimized ? "px-3 py-2" : "px-4 py-3 sm:px-5",
        )}
      >
        <div className="min-w-0 flex-1">
          <h2
            className={cn(
              "flex items-center gap-1.5 truncate font-medium",
              isMinimized ? "text-xs" : "text-sm sm:text-base",
            )}
          >
            <Lock
              className={cn(
                "shrink-0 text-primary",
                isMinimized ? "size-3" : "size-3.5",
              )}
              aria-label="Encrypted"
            />
            <span className="truncate">{title}</span>
          </h2>
          {!isMinimized ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {asset.mediaType}
              {asset.width && asset.height
                ? ` · ${asset.width} × ${asset.height}`
                : ""}
              {" · end-to-end encrypted"}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!isMinimized ? (
            <Button
              variant={showInfo ? "secondary" : "ghost"}
              size="icon"
              className="size-8"
              aria-label="Photo information"
              aria-pressed={showInfo}
              onClick={() => setShowInfo((visible) => !visible)}
            >
              <Info className="size-4" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className={isMinimized ? "size-6" : "size-8"}
            aria-label={isMinimized ? "Restore preview" : "Minimize preview"}
            onClick={() => setIsMinimized((minimized) => !minimized)}
          >
            {isMinimized ? (
              <Maximize2 className="size-4" />
            ) : (
              <Minimize2 className="size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={isMinimized ? "size-6" : "size-8"}
            aria-label="Close preview"
            onClick={closePreview}
          >
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 bg-black/5 dark:bg-black/20">
        <div className="relative min-w-0 flex-1">
          <LightboxContent key={asset.id} asset={asset} compact={isMinimized} />

          {previous && !isMinimized ? (
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 top-1/2 z-30 size-10 -translate-y-1/2 rounded-full bg-black/40 text-white shadow-lg backdrop-blur-sm hover:bg-black/60 hover:text-white"
              aria-label="Previous photo"
              onClick={selectPrevious}
            >
              <ChevronLeft className="size-5" />
            </Button>
          ) : null}
          {next && !isMinimized ? (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 z-30 size-10 -translate-y-1/2 rounded-full bg-black/40 text-white shadow-lg backdrop-blur-sm hover:bg-black/60 hover:text-white"
              aria-label="Next photo"
              onClick={selectNext}
            >
              <ChevronRight className="size-5" />
            </Button>
          ) : null}
        </div>

        {showInfo && !isMinimized ? (
          <aside className="hidden w-72 shrink-0 border-l bg-card p-5 md:block">
            <h3 className="text-sm font-semibold">Details</h3>
            <dl className="mt-5 space-y-4 text-sm">
              <Detail label="Captured" value={new Date(asset.takenAt).toLocaleString()} />
              <Detail label="Type" value={asset.mediaType} />
              {asset.width && asset.height ? (
                <Detail label="Dimensions" value={`${asset.width} × ${asset.height}`} />
              ) : null}
              <Detail label="Protection" value="End-to-end encrypted" />
            </dl>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 capitalize">{value}</dd>
    </div>
  );
}

function LightboxContent({
  asset,
  compact,
}: {
  asset: TimelineAsset;
  compact: boolean;
}) {
  const productCrypto = useProductCrypto();
  const [displayUrl, setDisplayUrl] = useState(asset.previewUrl ?? "");
  const [loadedVariant, setLoadedVariant] = useState<ContentVariant | null>(null);
  const [wantOriginal, setWantOriginal] = useState(asset.mediaType === "video");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const objectUrlRef = useRef("");
  const variant: ContentVariant =
    wantOriginal || asset.mediaType === "video" ? "original" : "optimized";

  const decryptVariant = useCallback(
    async (requestedVariant: ContentVariant) => {
      const response = await fetch(
        `/api/photos/assets/${encodeURIComponent(asset.id)}/content?variant=${requestedVariant}`,
        { credentials: "include", cache: "no-store" },
      );
      const descriptor = (await response.json().catch(() => ({}))) as ContentDescriptor;
      if (
        !response.ok ||
        !descriptor.url ||
        !descriptor.accountId ||
        !descriptor.spaceId ||
        !descriptor.objectKey ||
        !descriptor.encryptedDEK ||
        !descriptor.iv ||
        !descriptor.spaceKeyWrapIv
      ) {
        throw new Error(descriptor.error ?? "Preview unavailable");
      }
      const ciphertext = await fetchCachedPhotoCiphertext(
        descriptor.url,
        photoPreviewCacheKey({
          accountId: descriptor.accountId,
          objectKey: descriptor.objectKey,
          spaceId: descriptor.spaceId,
          variant: descriptor.variant ?? requestedVariant,
        }),
      );
      const plaintext = await productCrypto.withProductKey(
        descriptor.spaceId,
        (productSpaceKey) =>
          decryptPhotoFile(
            ciphertext,
            productSpaceKey,
            {
              accountId: descriptor.accountId!,
              spaceId: descriptor.spaceId!,
              objectKey: descriptor.objectKey!,
            },
            {
              encryptedDEK: descriptor.encryptedDEK!,
              iv: descriptor.iv!,
              spaceKeyWrapIv: descriptor.spaceKeyWrapIv!,
            },
          ),
      );
      return {
        blob: new Blob([plaintext], {
          type:
            descriptor.contentType &&
            descriptor.contentType !== "application/octet-stream"
              ? descriptor.contentType
              : asset.mediaType === "video"
                ? "video/mp4"
                : detectImageType(new Uint8Array(plaintext)),
        }),
        contentType: descriptor.contentType ?? "",
      };
    },
    [asset.id, asset.mediaType, productCrypto],
  );

  useEffect(() => {
    let cancelled = false;
    void decryptVariant(variant)
      .then(({ blob }) => {
        if (cancelled) return;
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const nextUrl = URL.createObjectURL(blob);
        objectUrlRef.current = nextUrl;
        setDisplayUrl(nextUrl);
        setLoadedVariant(variant);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Preview unavailable",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [decryptVariant, variant]);

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  const fileExtension = useMemo(() => {
    if (asset.mediaType === "video") return "mp4";
    return "jpg";
  }, [asset.mediaType]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    setError("");
    try {
      const { blob, contentType } = await decryptVariant("original");
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `xenode-${asset.mediaType}-${asset.id}.${extensionFor(
        contentType,
        fileExtension,
      )}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error ? downloadError.message : "Download failed",
      );
    } finally {
      setDownloading(false);
    }
  }, [asset.id, asset.mediaType, decryptVariant, fileExtension]);

  const toggleOriginal = () => {
    setLoading(true);
    setError("");
    setWantOriginal((original) => !original);
  };

  return (
    <div className="relative grid size-full place-items-center overflow-hidden">
      {displayUrl ? (
        asset.mediaType === "video" ? (
          <video
            src={displayUrl}
            className="size-full object-contain"
            controls
            autoPlay={!compact}
            playsInline
          />
        ) : (
          <>
            {/* Blob URLs contain plaintext only in memory and are revoked on unmount. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayUrl}
              alt=""
              className="max-h-[calc(100dvh-8.5rem)] w-auto max-w-full object-contain"
            />
          </>
        )
      ) : asset.mediaType === "video" ? (
        <Play className="size-14 text-muted-foreground" />
      ) : null}

      {loading ? (
        <div className="absolute inset-0 grid place-items-center bg-background/75 backdrop-blur-sm">
          <div className="text-center">
            <Loader2 className="mx-auto size-8 animate-spin text-primary" />
            <p className="mt-3 text-sm font-medium">
              {variant === "original" ? "Loading original…" : "Loading preview…"}
            </p>
          </div>
        </div>
      ) : null}

      {error && !displayUrl ? (
        <div className="absolute inset-0 grid place-items-center px-6 text-center">
          <div>
            <AlertCircle className="mx-auto size-10 text-destructive" />
            <p className="mt-3 text-sm text-destructive">{error}</p>
          </div>
        </div>
      ) : null}

      {!compact ? (
        <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
          {asset.mediaType === "image" ? (
            <Button
              variant={wantOriginal ? "default" : "outline"}
              size="sm"
              className="h-8 bg-card/90 shadow-sm backdrop-blur"
              disabled={loading && wantOriginal}
              onClick={toggleOriginal}
              title="Toggle original full-resolution image"
            >
              {loading && wantOriginal ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              HD
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-8 bg-card/90 shadow-sm backdrop-blur"
            disabled={downloading}
            onClick={() => void handleDownload()}
          >
            {downloading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            Download
          </Button>
        </div>
      ) : null}

      {loadedVariant === "original" && asset.mediaType === "image" && !compact ? (
        <span className="absolute bottom-3 rounded-full bg-black/50 px-3 py-1 text-[11px] text-white backdrop-blur">
          Original quality
        </span>
      ) : null}
    </div>
  );
}

function extensionFor(contentType: string, fallback: string) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("quicktime")) return "mov";
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("mp4")) return "mp4";
  return fallback;
}

function detectImageType(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return "image/jpeg";
}

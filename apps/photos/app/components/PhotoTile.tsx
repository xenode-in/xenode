"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Image as ImageIcon, Loader2, Play } from "lucide-react";
import { cn } from "@xenode/ui";
import { useProductCrypto } from "@xenode/crypto-react";
import { usePhotoSelection } from "./SelectionController";
import type { TimelineAsset } from "./Timeline";
import { decryptPhotoFile } from "@/lib/photo-encryption";

export function PhotoTile({
  asset,
  density,
  onOpen,
}: {
  asset: TimelineAsset;
  density: "comfortable" | "compact";
  onOpen(asset: TimelineAsset): void;
}) {
  const selection = usePhotoSelection();
  const productCrypto = useProductCrypto();
  const checked = selection.selected.has(asset.id);
  const hue = hashHue(asset.id);
  const date = new Date(asset.takenAt);
  const tile = useRef<HTMLElement>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewRequested, setPreviewRequested] = useState(false);

  useEffect(() => {
    const element = tile.current;
    if (!element || previewRequested || asset.mediaType !== "image") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setPreviewRequested(true);
        observer.disconnect();
      },
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [asset.mediaType, previewRequested]);

  useEffect(() => {
    if (!previewRequested || asset.mediaType !== "image") return;
    let cancelled = false;
    let createdUrl = "";
    void (async () => {
      const response = await fetch(
        `/api/photos/assets/${encodeURIComponent(asset.id)}/content?variant=thumbnail`,
        { credentials: "include", cache: "no-store" },
      );
      const descriptor = (await response.json().catch(() => ({}))) as {
        accountId?: string;
        contentType?: string;
        encryptedDEK?: string;
        error?: string;
        iv?: string;
        objectKey?: string;
        spaceId?: string;
        spaceKeyWrapIv?: string;
        url?: string;
      };
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
        throw new Error(descriptor.error ?? "Photo preview unavailable");
      }
      const encryptedResponse = await fetch(descriptor.url);
      if (!encryptedResponse.ok) throw new Error("Could not read photo");
      const ciphertext = await encryptedResponse.arrayBuffer();
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
      if (cancelled) return;
      createdUrl = URL.createObjectURL(
        new Blob([plaintext], {
          type:
            descriptor.contentType &&
            descriptor.contentType !== "application/octet-stream"
              ? descriptor.contentType
              : detectImageType(new Uint8Array(plaintext)),
        }),
      );
      setPreviewUrl(createdUrl);
    })().catch(() => {
      // Keep the encrypted placeholder when a preview cannot be loaded.
    });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [asset.id, asset.mediaType, previewRequested, productCrypto]);

  return (
    <article
      ref={tile}
      className={cn(
        "group relative isolate overflow-hidden rounded-xl border bg-muted transition duration-300 hover:-translate-y-0.5 hover:shadow-lg",
        checked
          ? "border-primary ring-2 ring-primary/60 ring-offset-2 ring-offset-background"
          : "border-border/50",
        density === "compact" ? "aspect-square" : "aspect-[4/3]",
      )}
      style={{
        background: `linear-gradient(145deg, hsl(${hue} 54% 30%), hsl(${(hue + 42) % 360} 58% 14%))`,
      }}
    >
      <button
        type="button"
        onClick={() => onOpen({ ...asset, previewUrl })}
        className="absolute inset-0 z-0 w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
        aria-label={`Open ${asset.mediaType} from ${date.toLocaleDateString()}`}
      >
        {previewUrl ? (
          // Blob URLs contain plaintext only in memory and are revoked on unmount.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt=""
            className="absolute inset-0 size-full object-cover transition duration-700 group-hover:scale-105"
          />
        ) : (
          <span className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(255,255,255,.22),transparent_34%)]" />
        )}
        <span className="absolute inset-0 grid place-items-center text-white/55 transition duration-500 group-hover:text-white/75">
          {asset.mediaType === "video" ? (
            <span className="grid size-12 place-items-center rounded-full bg-black/25 backdrop-blur-sm">
              <Play className="size-5 fill-current" />
            </span>
          ) : previewRequested && !previewUrl ? (
            <Loader2 className="size-5 animate-spin" />
          ) : previewUrl ? null : (
            <ImageIcon className="size-9" strokeWidth={1.4} />
          )}
        </span>
        <span className="absolute inset-x-0 bottom-0 translate-y-2 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 pb-3 pt-12 text-white opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <span className="block text-xs font-medium">
            {date.toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          {asset.width && asset.height ? (
            <span className="block text-[10px] text-white/65">
              {asset.width} × {asset.height}
            </span>
          ) : null}
        </span>
      </button>

      <button
        type="button"
        onClick={() => selection.toggle(asset.id)}
        className={cn(
          "absolute left-2 top-2 z-10 grid size-7 place-items-center rounded-full border text-white shadow-sm backdrop-blur-md transition",
          checked
            ? "border-primary bg-primary opacity-100"
            : "border-white/70 bg-black/25 opacity-0 hover:bg-black/45 group-hover:opacity-100",
        )}
        aria-label={checked ? `Deselect ${asset.id}` : `Select ${asset.id}`}
      >
        {checked ? (
          <Check className="size-4" />
        ) : (
          <span className="size-3 rounded-full border-2 border-current" />
        )}
      </button>
    </article>
  );
}

function hashHue(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 360;
  }
  return hash;
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
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
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
  return "application/octet-stream";
}

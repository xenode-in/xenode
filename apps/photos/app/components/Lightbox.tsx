"use client";

import { useEffect, useState } from "react";
import { Download, Image as ImageIcon, Info, Play, X } from "lucide-react";
import { Button } from "@xenode/ui";
import { useProductCrypto } from "@xenode/crypto-react";
import type { TimelineAsset } from "./Timeline";
import { decryptPhotoFile } from "@/lib/photo-encryption";

export function Lightbox({
  asset,
  onClose,
}: {
  asset: TimelineAsset | null;
  onClose(): void;
}) {
  if (!asset) return null;
  const hue = hashHue(asset.id);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white backdrop-blur-xl"
      onClick={onClose}
    >
      <header className="flex h-16 items-center justify-between border-b border-white/10 px-4">
        <p className="text-sm text-white/70">
          {new Date(asset.takenAt).toLocaleString()}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-white hover:bg-white/10 hover:text-white"
            aria-label="Photo information"
            onClick={(event) => event.stopPropagation()}
          >
            <Info />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-white hover:bg-white/10 hover:text-white"
            aria-label="Download photo"
            onClick={(event) => event.stopPropagation()}
          >
            <Download />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-white hover:bg-white/10 hover:text-white"
            aria-label="Close viewer"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 place-items-center p-5 sm:p-10">
        <div
          className="relative grid h-full max-h-[72vh] w-full max-w-5xl place-items-center overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
          style={{
            aspectRatio:
              asset.width && asset.height
                ? `${asset.width}/${asset.height}`
                : "16/10",
            background: `linear-gradient(145deg, hsl(${hue} 54% 28%), hsl(${(hue + 42) % 360} 58% 10%))`,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(255,255,255,.22),transparent_34%)]" />
          <LightboxContent key={asset.id} asset={asset} />
        </div>
      </div>
    </div>
  );
}

function LightboxContent({ asset }: { asset: TimelineAsset }) {
  const productCrypto = useProductCrypto();
  const [displayUrl, setDisplayUrl] = useState(asset.previewUrl ?? "");

  useEffect(() => {
    if (asset.mediaType !== "image") return;
    let cancelled = false;
    let optimizedUrl = "";
    void (async () => {
      const response = await fetch(
        `/api/photos/assets/${encodeURIComponent(asset.id)}/content?variant=optimized`,
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
        throw new Error(descriptor.error ?? "Optimized photo unavailable");
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
      optimizedUrl = URL.createObjectURL(
        new Blob([plaintext], {
          type: descriptor.contentType ?? "image/jpeg",
        }),
      );
      setDisplayUrl(optimizedUrl);
    })().catch(() => {
      // Keep showing the decrypted thumbnail if optimized loading fails.
    });
    return () => {
      cancelled = true;
      if (optimizedUrl) URL.revokeObjectURL(optimizedUrl);
    };
  }, [asset.id, asset.mediaType, productCrypto]);

  if (displayUrl) {
    return (
      // Blob URLs contain plaintext only in memory and are revoked on unmount.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={displayUrl}
        alt=""
        className="absolute inset-0 size-full object-contain"
      />
    );
  }
  if (asset.mediaType === "video") {
    return (
      <span className="relative grid size-20 place-items-center rounded-full bg-black/30 backdrop-blur">
        <Play className="size-8 fill-current" />
      </span>
    );
  }
  return <ImageIcon className="relative size-16 text-white/55" strokeWidth={1.2} />;
}

function hashHue(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 360;
  }
  return hash;
}

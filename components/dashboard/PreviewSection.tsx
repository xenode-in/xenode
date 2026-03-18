"use client";

import Link from "next/link";
import { Play, Music2 } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { useCrypto } from "@/contexts/CryptoContext";
import { decryptFileName } from "@/lib/crypto/fileEncryption";
import { useState, useEffect, useMemo } from "react";

interface ObjectData {
  id: string;
  key: string;
  size: number;
  contentType: string;
  createdAt: string;
  thumbnail?: string;
  isEncrypted?: boolean;
  encryptedName?: string;
}

interface PreviewSectionProps {
  videos: ObjectData[];
  images: ObjectData[];
  audios: ObjectData[];
}

function getFileName(key: string) {
  return key.split("/").pop() || key;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PreviewSection({
  videos,
  images,
  audios,
}: PreviewSectionProps) {
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>(
    {},
  );
  const { isUnlocked } = useCrypto();

  const allItems = useMemo(
    () => [...videos, ...images, ...audios],
    [videos, images, audios],
  );

  useEffect(() => {
    if (!isUnlocked || !allItems.length) {
      setDecryptedNames((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }

    const decryptNames = async () => {
      const newNames: Record<string, string> = {};
      for (const item of allItems) {
        if (
          item.isEncrypted &&
          item.encryptedName &&
          !decryptedNames[item.id]
        ) {
          try {
            const name = await decryptFileName(item.encryptedName);
            newNames[item.id] = name;
          } catch (e) {
            console.error("Failed to decrypt name", e);
          }
        }
      }
      if (Object.keys(newNames).length > 0) {
        setDecryptedNames((prev) => ({ ...prev, ...newNames }));
      }
    };

    decryptNames();
  }, [allItems, isUnlocked]);

  const hasContent =
    videos.length > 0 || images.length > 0 || audios.length > 0;

  if (!hasContent) return null;

  const featuredVideo = videos[0];
  const previewImages = images.slice(0, 2);
  const featuredAudio = audios[0];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">Preview</h2>
        <Link
          href="/dashboard/files"
          className="text-xs text-primary hover:underline"
        >
          View in folders
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Featured Video Card */}
        {featuredVideo && (
          <div className="relative rounded-xl overflow-hidden bg-card border border-border aspect-video group cursor-pointer hover:border-primary/40 transition-colors">
            {featuredVideo.thumbnail ? (
              <img
                src={featuredVideo.thumbnail}
                alt={getFileName(featuredVideo.key)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-secondary flex items-center justify-center">
                <Play className="w-10 h-10 text-muted-foreground/30" />
              </div>
            )}
            {/* Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            {/* Duration badge */}
            <div className="absolute top-3 right-3 bg-black/60 text-white text-xs px-2 py-0.5 rounded-md font-mono">
              {formatBytes(featuredVideo.size)}
            </div>
            {/* Play button */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/30">
                <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
              </div>
            </div>
            {/* File name */}
            <div className="absolute bottom-3 left-3 right-3">
              <p className="text-white text-sm font-medium truncate">
                {decryptedNames[featuredVideo.id] ||
                  featuredVideo.encryptedName ||
                  getFileName(featuredVideo.key)}
              </p>
              <p className="text-white/60 text-xs">
                {formatBytes(featuredVideo.size)}
              </p>
            </div>
          </div>
        )}

        {/* Right column: image thumbnails + audio */}
        <div className="flex flex-col gap-3">
          {/* Image thumbnails row */}
          {previewImages.length > 0 && (
            <div className="grid grid-cols-2 gap-3 flex-1">
              {previewImages.map((img) => (
                <Link
                  key={img.id}
                  href="/dashboard/photos"
                  className="relative rounded-xl overflow-hidden bg-card border border-border aspect-video group cursor-pointer hover:border-primary/40 transition-colors"
                >
                  {img.thumbnail ? (
                    <img
                      src={img.thumbnail}
                      alt={getFileName(img.key)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-secondary" />
                  )}
                  <div className="absolute bottom-1 left-2 right-2">
                    <p className="text-white text-xs font-medium truncate drop-shadow">
                      {decryptedNames[img.id] ||
                        img.encryptedName ||
                        getFileName(img.key)}
                    </p>
                    <p className="text-white/60 text-[10px]">
                      {formatBytes(img.size)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Audio waveform row */}
          {featuredAudio && (
            <div className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Play className="w-3.5 h-3.5 text-primary ml-0.5" />
              </div>
              {/* Fake waveform bars */}
              <div className="flex items-center gap-0.5 flex-1 h-8 overflow-hidden">
                {Array.from({ length: 40 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-full bg-primary/40"
                    style={{
                      height: `${Math.round(20 + Math.sin(i * 0.8) * 12 + Math.cos(i * 1.3) * 8)}px`,
                      minWidth: "2px",
                    }}
                  />
                ))}
              </div>
              <span className="text-xs text-muted-foreground font-mono shrink-0">
                {formatBytes(featuredAudio.size)}
              </span>
            </div>
          )}

          {/* If only audio, no images — show audio more prominently */}
          {previewImages.length === 0 && featuredAudio && (
            <div className="flex-1 bg-card border border-border rounded-xl flex items-center justify-center">
              <Music2 className="w-12 h-12 text-muted-foreground/20" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

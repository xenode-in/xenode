/**
 * components/dashboard/MetadataDialog.tsx
 */

"use client";

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { decryptMetadataObject } from "@/lib/crypto/fileEncryption";
import { FileMetadata } from "@/lib/metadata/types";
import { formatBytes, formatDate } from "@/lib/utils";
import {
  Info,
  File as FileIcon,
  Image as ImageIcon,
  Video as VideoIcon,
  Music as MusicIcon,
  MapPin,
  Cpu,
  Layers,
  Clock,
  Maximize,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface MetadataDialogProps {
  item: any;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  metadataKey: CryptoKey | null;
}

export function MetadataDialog({
  item,
  isOpen,
  onOpenChange,
  metadataKey,
}: MetadataDialogProps) {
  const [metadata, setMetadata] = useState<FileMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && metadataKey && item.id) {
      setLoading(true);
      setError(null);
      setMetadata(null);

      fetch(`/api/objects/${item.id}/metadata`)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch metadata");
          return res.json();
        })
        .then(async (data) => {
          if (!data.encryptedMetadata) {
            setMetadata(null);
            return;
          }
          const decrypted = await decryptMetadataObject(
            data.encryptedMetadata,
            metadataKey,
          );
          setMetadata(decrypted);
        })
        .catch((err) => {
          console.error("[MetadataDialog] Error:", err);
          setError("Failed to load or decrypt metadata.");
        })
        .finally(() => setLoading(false));
    }
  }, [isOpen, item.id, metadataKey]);

  const renderSection = (
    title: string,
    icon: React.ReactNode,
    fields: { label: string; value: any; suffix?: string }[],
  ) => {
    const validFields = fields.filter(
      (f) => f.value !== null && f.value !== undefined && f.value !== "",
    );
    if (validFields.length === 0) return null;

    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-primary">
          {icon}
          {title}
        </h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 bg-secondary/30 p-3 rounded-lg border border-border/50">
          {validFields.map((field, i) => (
            <React.Fragment key={i}>
              <span className="text-xs text-muted-foreground">{field.label}</span>
              <span className="text-xs font-medium text-foreground truncate text-right">
                {field.value}
                {field.suffix}
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-border shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Info className="w-5 h-5 text-primary" />
            <DialogTitle>File Metadata</DialogTitle>
          </div>
          <DialogDescription className="text-muted-foreground/60">
            {metadata?.name || item.key.split("/").pop() || "Encrypted Metadata"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-muted-foreground">Decrypting...</span>
            </div>
          ) : error ? (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm text-center">
              {error}
            </div>
          ) : metadata ? (
            <>
              {/* BASIC INFO */}
              {renderSection("Basic Information", <FileIcon className="w-4 h-4" />, [
                { label: "File Name", value: metadata.name },
                { label: "Size", value: formatBytes(metadata.size || 0) },
                { label: "Type", value: metadata.type },
                { label: "Extension", value: metadata.extension?.toUpperCase() },
                { label: "Last Modified", value: metadata.lastModified ? formatDate(metadata.lastModified) : null },
              ])}

              {/* MEDIA INFO */}
              {(metadata.width || metadata.duration) &&
                renderSection(
                  metadata.mediaCategory === "image" ? "Image Properties" : "Media Properties",
                  metadata.mediaCategory === "image" ? <ImageIcon className="w-4 h-4" /> : <VideoIcon className="w-4 h-4" />,
                  [
                    { label: "Dimensions", value: metadata.width && metadata.height ? `${metadata.width} × ${metadata.height}` : null },
                    { label: "Aspect Ratio", value: metadata.aspectRatio?.toFixed(2) },
                    { label: "Duration", value: metadata.duration ? `${metadata.duration.toFixed(2)}s` : null },
                  ],
                )}

              {/* EXIF / JFIF */}
              {renderSection("Advanced Header Data", <Maximize className="w-4 h-4" />, [
                { label: "Date Taken", value: metadata.dateTaken ? formatDate(metadata.dateTaken) : null },
                { label: "Device Brand", value: metadata.deviceBrand },
                { label: "Device Model", value: metadata.deviceModel },
                { label: "JFIF Version", value: metadata.jfifVersion },
                { label: "Resolution Unit", value: metadata.resolutionUnit },
                { label: "X-Resolution", value: metadata.xResolution },
                { label: "Y-Resolution", value: metadata.yResolution },
              ])}

              {/* GPS */}
              {renderSection("Location Data", <MapPin className="w-4 h-4" />, [
                { label: "Latitude", value: metadata.gpsLatitude?.toFixed(6) },
                { label: "Longitude", value: metadata.gpsLongitude?.toFixed(6) },
              ])}

              {/* TECHNICAL */}
              {renderSection("Technical Details", <Cpu className="w-4 h-4" />, [
                { label: "Video Codec", value: metadata.videoCodec },
                { label: "Audio Codec", value: metadata.audioCodec },
                { label: "Frame Rate", value: metadata.fps, suffix: " fps" },
                { label: "Bitrate", value: metadata.bitrate, suffix: " kbps" },
                { label: "Sample Rate", value: metadata.audioSampleRate, suffix: " Hz" },
                { label: "Channels", value: metadata.audioChannels },
                { label: "Created At", value: metadata.creationTime },
              ])}

              {/* CHUNKS */}
              {renderSection("Encryption Chunks", <Layers className="w-4 h-4" />, [
                { label: "Chunk Size", value: metadata.chunkSize ? formatBytes(metadata.chunkSize) : null },
                { label: "Chunk Count", value: metadata.chunkCount },
              ])}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
              <span className="text-sm text-muted-foreground/60 italic">
                Advanced metadata is only available for newer E2EE uploads.
              </span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 bg-secondary/30 p-3 rounded-lg border border-border/50 w-full text-left">
                <span className="text-xs text-muted-foreground">Original Name</span>
                <span className="text-xs font-medium text-foreground truncate text-right">{item.key.split("/").pop()}</span>
                <span className="text-xs text-muted-foreground">Size</span>
                <span className="text-xs font-medium text-foreground truncate text-right">{formatBytes(item.size)}</span>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

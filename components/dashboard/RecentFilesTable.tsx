"use client";
import Link from "next/link";
import {
  FileText,
  Image,
  Music,
  Video,
  File,
  MoreHorizontal,
  Lock,
} from "lucide-react";
import { formatBytes, formatDate } from "@/lib/utils";
import { useCrypto } from "@/contexts/CryptoContext";
import { decryptMetadataString, buildAad } from "@/lib/crypto/fileEncryption";
import { CRYPTO_VERSION } from "@/lib/crypto/utils";
import { useState, useEffect } from "react";

interface ObjectData {
  id: string;
  key: string;
  size: number;
  contentType: string;
  createdAt: string;
  thumbnail?: string;
  isEncrypted?: boolean;
  encryptedName?: string;
  bucketId: string;
}

function getFileName(key: string) {
  return key.split("/").pop() || key;
}

function FileTypeIcon({ contentType }: { contentType: string }) {
  if (contentType.startsWith("image/"))
    return <Image className="w-4 h-4 text-blue-400" />;
  if (contentType.startsWith("video/"))
    return <Video className="w-4 h-4 text-purple-400" />;
  if (contentType.startsWith("audio/"))
    return <Music className="w-4 h-4 text-green-400" />;
  if (contentType.includes("pdf") || contentType.includes("document"))
    return <FileText className="w-4 h-4 text-red-400" />;
  return <File className="w-4 h-4 text-muted-foreground/50" />;
}

function getTypeBadgeLabel(contentType: string) {
  if (contentType.startsWith("image/"))
    return contentType.split("/")[1]?.toUpperCase() ?? "IMG";
  if (contentType.startsWith("video/"))
    return contentType.split("/")[1]?.toUpperCase() ?? "VID";
  if (contentType.startsWith("audio/"))
    return contentType.split("/")[1]?.toUpperCase() ?? "AUD";
  if (contentType.includes("pdf")) return "PDF";
  return contentType.split("/")[1]?.toUpperCase() ?? "FILE";
}

interface RecentFilesTableProps {
  files: ObjectData[];
}

export function RecentFilesTable({ files }: RecentFilesTableProps) {
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>(
    {},
  );
  const { isUnlocked, metadataKey, session } = useCrypto() as any;
  const userId = session?.user?.id;

  useEffect(() => {
    if (!isUnlocked || !files.length) {
      setDecryptedNames((prev) => Object.keys(prev).length ? {} : prev);
      return;
    }

    const decryptNames = async () => {
      const newNames: Record<string, string> = {};
      for (const file of files) {
        if (
          file.isEncrypted &&
          file.encryptedName &&
          !decryptedNames[file.id]
        ) {
          try {
            const aad = buildAad({ 
              userId, 
              bucketId: file.bucketId, 
              objectKey: file.key, 
              version: CRYPTO_VERSION 
            });
            const name = await decryptMetadataString(file.encryptedName, metadataKey, aad);
            newNames[file.id] = name;
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
  }, [files, isUnlocked]);

  if (files.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">Recent Files</h2>
        <Link
          href="/dashboard/files"
          className="text-xs text-primary hover:underline"
        >
          View all files
        </Link>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[2fr_1fr_1fr_40px] gap-4 px-4 py-2 border-b border-border">
          <span className="text-xs text-muted-foreground">Name</span>
          <span className="text-xs text-muted-foreground">Size</span>
          <span className="text-xs text-muted-foreground">Last Modified</span>
          <span className="text-xs text-muted-foreground text-right">
            Action
          </span>
        </div>

        {/* Rows */}
        {files.map((file) => (
          <div
            key={file.id}
            className="grid grid-cols-[2fr_1fr_1fr_40px] gap-4 px-4 py-3 border-b border-border/50 last:border-0 hover:bg-secondary/40 transition-colors items-center"
          >
            {/* Name */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                <FileTypeIcon contentType={file.contentType} />
              </div>
              <span className="text-sm text-foreground truncate">
                {decryptedNames[file.id] ||
                  file.encryptedName ||
                  getFileName(file.key)}
              </span>
              {file.isEncrypted && (
                <Lock className="w-3 h-3 text-primary/60 shrink-0" />
              )}
            </div>

            {/* Size */}
            <span className="text-sm text-muted-foreground">
              {formatBytes(file.size)}
            </span>

            {/* Last Modified */}
            <span className="text-sm text-muted-foreground">
              {new Date(file.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>

            {/* Action */}
            <button className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-secondary transition-colors ml-auto">
              <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

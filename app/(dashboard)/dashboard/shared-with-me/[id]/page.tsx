"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Download,
  Eye,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FilePreviewDialog } from "@/components/dashboard/FilePreviewDialog";
import { useCrypto } from "@/contexts/CryptoContext";
import {
  decryptChunk,
  decryptWithShareKey,
} from "@/lib/crypto/fileEncryption";
import { fromB64 } from "@/lib/crypto/utils";
import { formatBytes } from "@/lib/utils";

interface ShareDetail {
  _id: string;
  objectId: {
    _id: string;
    key: string;
    size: number;
    contentType: string;
    isEncrypted?: boolean;
    mediaCategory?: string;
  };
  owner?: {
    id: string;
    name?: string;
    email?: string;
  } | null;
  shareEncryptedDEK?: string;
  shareKeyIv?: string;
  shareEncryptedName?: string;
  shareEncryptedContentType?: string;
  recipient?: {
    wrappedShareKey: string;
    accessType: "view" | "download";
  };
  createdAt: string;
}

interface BlobResponse {
  streamUrl?: string;
  downloadUrl?: string;
  chunkUrls?: string[];
  isEncrypted: boolean;
  iv?: string;
  contentType: string;
  chunkIvs?: string;
  error?: string;
}

async function buildShareKey(wrappedShareKey: string, privateKey: CryptoKey) {
  const rawShareKey = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    fromB64(wrappedShareKey).buffer as ArrayBuffer,
  );

  return crypto.subtle.importKey(
    "raw",
    rawShareKey,
    { name: "AES-GCM" },
    false,
    ["decrypt", "unwrapKey"],
  );
}

async function buildDek(
  shareKey: CryptoKey,
  shareEncryptedDEK: string,
  shareKeyIv: string,
) {
  return crypto.subtle.unwrapKey(
    "raw",
    fromB64(shareEncryptedDEK).buffer as ArrayBuffer,
    shareKey,
    {
      name: "AES-GCM",
      iv: fromB64(shareKeyIv).buffer as ArrayBuffer,
    },
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
}

export default function SharedWithMeDetailPage() {
  const params = useParams<{ id: string }>();
  const shareId = params.id;
  const { isUnlocked, privateKey, setModalOpen } = useCrypto();
  const [share, setShare] = useState<ShareDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [resolvedName, setResolvedName] = useState("");
  const [resolvedContentType, setResolvedContentType] = useState("");

  useEffect(() => {
    const loadShare = async () => {
      try {
        const res = await fetch(`/api/direct-shares/${shareId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load share");
        setShare(data);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load share");
      } finally {
        setLoading(false);
      }
    };

    loadShare();
  }, [shareId]);

  useEffect(() => {
    if (!share) return;

    let active = true;

    const resolveMetadata = async () => {
      const fallbackName = share.objectId.key.split("/").pop() || share.objectId.key;
      const fallbackType = share.objectId.contentType || "application/octet-stream";

      if (
        !share.objectId.isEncrypted ||
        !share.shareEncryptedName ||
        !share.recipient?.wrappedShareKey ||
        !privateKey
      ) {
        if (active) {
          setResolvedName(fallbackName);
          setResolvedContentType(fallbackType);
        }
        return;
      }

      try {
        const shareKey = await buildShareKey(
          share.recipient.wrappedShareKey,
          privateKey,
        );
        const name = await decryptWithShareKey(share.shareEncryptedName, shareKey);
        const contentType = share.shareEncryptedContentType
          ? await decryptWithShareKey(share.shareEncryptedContentType, shareKey)
          : fallbackType;

        if (active) {
          setResolvedName(name);
          setResolvedContentType(contentType);
        }
      } catch (metadataError) {
        console.error("Failed to resolve direct share metadata", metadataError);
        if (active) {
          setResolvedName(fallbackName);
          setResolvedContentType(fallbackType);
        }
      }
    };

    resolveMetadata();

    return () => {
      active = false;
    };
  }, [share, privateKey]);

  const previewFile = useMemo(() => {
    if (!share) return null;

    return {
      id: share.objectId._id,
      key: share.objectId.key,
      size: share.objectId.size,
      contentType: resolvedContentType || share.objectId.contentType,
      createdAt: share.createdAt,
      isEncrypted: share.objectId.isEncrypted,
      encryptedName: undefined,
      name:
        resolvedName ||
        share.objectId.key.split("/").pop() ||
        share.objectId.key,
      mediaCategory: share.objectId.mediaCategory,
    };
  }, [share, resolvedContentType, resolvedName]);

  const fetchBlob = async (mode: "stream" | "download") => {
    if (!share) throw new Error("Share is not loaded");

    const res = await fetch(`/api/direct-shares/${shareId}/${mode}`, {
      method: "POST",
    });
    const data = (await res.json()) as BlobResponse;
    if (!res.ok) throw new Error(data.error || `Failed to ${mode} file`);

    if (!data.isEncrypted) {
      const sourceUrl = data.streamUrl || data.downloadUrl;
      if (!sourceUrl) throw new Error("Missing file URL");
      const blob = await fetch(sourceUrl).then((response) => response.blob());
      return new Blob([blob], { type: resolvedContentType || data.contentType });
    }

    if (
      !privateKey ||
      !share.recipient?.wrappedShareKey ||
      !share.shareEncryptedDEK ||
      !share.shareKeyIv
    ) {
      throw new Error("Unlock your vault to open this encrypted share");
    }

    const shareKey = await buildShareKey(share.recipient.wrappedShareKey, privateKey);
    const dek = await buildDek(shareKey, share.shareEncryptedDEK, share.shareKeyIv);

    if (data.chunkUrls?.length) {
      const chunkIvs = JSON.parse(data.chunkIvs || "[]");
      const plaintextChunks = [];
      for (let i = 0; i < data.chunkUrls.length; i += 1) {
        const chunkBuffer = await fetch(data.chunkUrls[i]).then((response) =>
          response.arrayBuffer(),
        );
        plaintextChunks.push(await decryptChunk(chunkBuffer, dek, chunkIvs[i]));
      }
      return new Blob(plaintextChunks, {
        type: resolvedContentType || data.contentType,
      });
    }

    const sourceUrl = data.streamUrl || data.downloadUrl;
    if (!sourceUrl || !data.iv) throw new Error("Missing encrypted file URL");

    const cipherBuffer = await fetch(sourceUrl).then((response) =>
      response.arrayBuffer(),
    );
    const plainBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(data.iv).buffer as ArrayBuffer },
      dek,
      cipherBuffer,
    );

    return new Blob([plainBuffer], {
      type: resolvedContentType || data.contentType,
    });
  };

  const handlePreview = async () => {
    if (!isUnlocked && share?.objectId.isEncrypted) {
      setModalOpen(true);
      return;
    }

    setError(null);
    setIsPreviewOpen(true);
  };

  const handleDownload = async () => {
    if (!isUnlocked && share?.objectId.isEncrypted) {
      setModalOpen(true);
      return;
    }

    setIsDownloading(true);
    setError(null);
    try {
      const blob = await fetchBlob("download");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = resolvedName || share?.objectId.key.split("/").pop() || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error ? downloadError.message : "Download failed",
      );
    } finally {
      setIsDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!share) {
    return (
      <div className="flex h-64 items-center justify-center text-destructive">
        <AlertCircle className="mr-2 h-5 w-5" />
        <p>{error || "Share not found"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2">
            <Button variant="ghost" size="sm" asChild className="px-0">
              <Link href="/dashboard/shared-with-me">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {resolvedName || share.objectId.key.split("/").pop() || share.objectId.key}
          </h1>
          <p className="text-muted-foreground">
            Shared by {share.owner?.name || share.owner?.email || "Unknown"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={handlePreview}>
            <Eye className="mr-2 h-4 w-4" />
            Preview
          </Button>
          <Button onClick={handleDownload} disabled={isDownloading}>
            {isDownloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Download
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Share Details</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Direct Share</Badge>
            {share.objectId.isEncrypted && (
              <Badge
                variant="outline"
                className="text-green-500 border-green-500/20 bg-green-500/10"
              >
                E2EE
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-border bg-secondary/20 p-4">
              <div className="text-muted-foreground">Size</div>
              <div className="mt-1 font-medium">{formatBytes(share.objectId.size)}</div>
            </div>
            <div className="rounded-md border border-border bg-secondary/20 p-4">
              <div className="text-muted-foreground">Type</div>
              <div className="mt-1 break-all font-medium">
                {resolvedContentType || share.objectId.contentType}
              </div>
            </div>
            <div className="rounded-md border border-border bg-secondary/20 p-4">
              <div className="text-muted-foreground">Access</div>
              <div className="mt-1 font-medium capitalize">
                {share.recipient?.accessType || "download"}
              </div>
            </div>
            <div className="rounded-md border border-border bg-secondary/20 p-4">
              <div className="text-muted-foreground">Shared</div>
              <div className="mt-1 font-medium">
                {new Date(share.createdAt).toLocaleString()}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <FilePreviewDialog
        file={previewFile}
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        directShareId={shareId}
        directShareWrappedKey={share.recipient?.wrappedShareKey}
        onDownload={handleDownload}
      />
    </div>
  );
}

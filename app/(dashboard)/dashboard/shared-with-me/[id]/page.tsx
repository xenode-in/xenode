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
import { decryptWithShareKey } from "@/lib/crypto/fileEncryption";
import { buildShareKey, fetchShareBlob } from "@/lib/crypto/directShare";
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
    accessType: string;
  };
  createdAt: string;
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
    return fetchShareBlob({
      shareId,
      mode,
      isEncrypted: share.objectId.isEncrypted,
      wrappedShareKey: share.recipient?.wrappedShareKey,
      shareEncryptedDEK: share.shareEncryptedDEK,
      shareKeyIv: share.shareKeyIv,
      privateKey,
      contentType: resolvedContentType,
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

"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Star, Loader2, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useCrypto } from "@/contexts/CryptoContext";
import { usePreview } from "@/contexts/PreviewContext";
import { useThumbnail } from "@/hooks/useThumbnail";
import { useIsVisible } from "@/hooks/useIsVisible";
import { decryptMetadataString } from "@/lib/crypto/fileEncryption";
import { getFileIcon } from "@/lib/file-icons";
import { formatBytes } from "@/lib/utils";

interface StarredObject {
  _id: string;
  key: string;
  size: number;
  contentType: string;
  thumbnail?: string;
  thumbnailUrl?: string;
  encryptedName?: string;
  encryptedDisplayName?: string;
  mediaCategory?: string;
  isEncrypted?: boolean;
  createdAt: string;
  decryptedName?: string;
}

function getFileName(key: string) {
  return key.split("/").pop() || key;
}

function Thumb({ item }: { item: StarredObject }) {
  const { metadataKey } = useCrypto();
  const [ref, isVisible] = useIsVisible();
  const url = useThumbnail(isVisible ? item.thumbnail : undefined, metadataKey);
  return (
    <div
      ref={ref}
      className="bg-muted flex h-10 w-10 items-center justify-center overflow-hidden rounded"
    >
      {url ? (
        <Image
          src={url}
          alt=""
          width={40}
          height={40}
          unoptimized
          className="h-10 w-10 object-cover"
        />
      ) : item.thumbnail ? (
        <ImageOff className="text-muted-foreground h-4 w-4" />
      ) : (
        getFileIcon(item.contentType, "w-4 h-4", item.mediaCategory)
      )}
    </div>
  );
}

export default function StarredPage() {
  const { metadataKey } = useCrypto();
  const { openPreview } = usePreview();
  const [bucketId, setBucketId] = useState<string | null>(null);
  const [items, setItems] = useState<StarredObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/drive/config");
        if (!res.ok) throw new Error("Failed to load drive config");
        const data = await res.json();
        if (!cancelled) setBucketId(data.bucket._id);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(
    async (bid: string) => {
      const res = await fetch(
        `/api/objects?bucketId=${bid}&starred=true&fetchAll=true`,
      );
      if (!res.ok) throw new Error("Failed to load starred items");
      const data = await res.json();
      const raw: StarredObject[] = data.objects ?? [];
      const withNames = await Promise.all(
        raw.map(async (o) => {
          let decryptedName = getFileName(o.key);
          const enc = o.encryptedDisplayName || o.encryptedName;
          if (enc && metadataKey) {
            try {
              decryptedName = await decryptMetadataString(enc, metadataKey);
            } catch {
              /* keep fallback */
            }
          }
          return { ...o, decryptedName };
        }),
      );
      setItems(withNames);
    },
    [metadataKey],
  );

  useEffect(() => {
    if (!bucketId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await load(bucketId);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bucketId, load]);

  const handleUnstar = async (id: string) => {
    // Optimistic removal — it no longer belongs in the Starred view.
    setItems((prev) => prev.filter((i) => i._id !== id));
    try {
      await fetch(`/api/objects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred: false }),
      });
    } catch {
      // Best-effort; a reload would resurface it if the call failed.
    }
  };

  const handleOpen = (item: StarredObject) => {
    // PreviewContext reads `.id`; our objects carry `_id`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asLegacy = (o: StarredObject) => ({ ...o, id: o._id }) as any;
    openPreview(asLegacy(item), {
      sourceContext: "owned",
      intent: "preview",
      fileList: items.map(asLegacy),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Star className="h-6 w-6" /> Starred
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Files you&apos;ve starred for quick access.
        </p>
      </div>

      {error && (
        <div className="text-destructive bg-destructive/10 border-destructive/20 rounded-lg border px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="text-primary h-6 w-6 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-24">
          <Star className="h-10 w-10" />
          <p>No starred files yet.</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table className="min-w-[700px] md:min-w-full">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Starred</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item._id}
                  className="cursor-pointer"
                  onClick={() => handleOpen(item)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Thumb item={item} />
                      <span className="max-w-[320px] truncate font-medium">
                        {item.decryptedName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatBytes(item.size)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className="bg-secondary text-muted-foreground/60 border-0 text-xs"
                    >
                      {item.contentType.split("/").pop()}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Unstar"
                      onClick={() => handleUnstar(item._id)}
                    >
                      <Star className="fill-primary text-primary h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

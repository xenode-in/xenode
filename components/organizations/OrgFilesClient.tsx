"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Database,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useCrypto } from "@/contexts/CryptoContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  encryptOrgFile,
  unwrapSpaceKeyGrant,
} from "@/lib/orgs/spaceKeyClient";
import { formatBytes, formatDate } from "@/lib/utils";

interface BucketRow {
  _id: string;
  name: string;
  objectCount: number;
  totalSizeBytes: number;
  createdAt: string;
}

interface ObjectRow {
  _id: string;
  key: string;
  size: number;
  contentType: string;
  mediaCategory: string;
  isEncrypted: boolean;
  wrappedBy?: "user" | "space";
  spaceKeyVersion?: number;
  createdAt: string;
}

interface SpaceKeyGrant {
  wrappedSpaceKey: string;
  keyVersion: number;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Request failed",
    );
  }
  return data as T;
}

function displayObjectName(key: string): string {
  const parts = key.split("/").filter(Boolean);
  return parts[parts.length - 1] || key;
}

export function OrgFilesClient({
  orgId,
  orgName,
}: {
  orgId: string;
  orgName: string;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { privateKey, setModalOpen } = useCrypto();
  const [buckets, setBuckets] = useState<BucketRow[]>([]);
  const [objects, setObjects] = useState<ObjectRow[]>([]);
  const [selectedBucketId, setSelectedBucketId] = useState("");
  const [bucketName, setBucketName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const selectedBucket = useMemo(
    () =>
      buckets.find((bucket) => bucket._id === selectedBucketId) ??
      buckets[0] ??
      null,
    [buckets, selectedBucketId],
  );

  const loadBuckets = useCallback(async () => {
    const data = await readJson<{ buckets: BucketRow[] }>(
      await fetch(`/api/orgs/${orgId}/buckets`),
    );
    setBuckets(data.buckets);
    setSelectedBucketId((current) => {
      if (current && data.buckets.some((bucket) => bucket._id === current)) {
        return current;
      }
      return data.buckets[0]?._id || "";
    });
  }, [orgId]);

  const loadObjects = useCallback(async () => {
    if (!selectedBucket?.["_id"]) {
      setObjects([]);
      return;
    }
    const data = await readJson<{ objects: ObjectRow[] }>(
      await fetch(
        `/api/orgs/${orgId}/objects?bucketId=${selectedBucket._id}&fetchAll=true`,
      ),
    );
    setObjects(data.objects);
  }, [orgId, selectedBucket]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await loadBuckets();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load buckets",
      );
    } finally {
      setLoading(false);
    }
  }, [loadBuckets]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void loadObjects();
  }, [loadObjects]);

  const createBucket = async () => {
    const name = bucketName.trim().toLowerCase();
    if (!name) {
      toast.error("Bucket name is required");
      return;
    }
    setBusy("bucket");
    try {
      const data = await readJson<{ bucket: BucketRow }>(
        await fetch(`/api/orgs/${orgId}/buckets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }),
      );
      setBucketName("");
      toast.success("Bucket created");
      await loadBuckets();
      setSelectedBucketId(data.bucket._id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create bucket",
      );
    } finally {
      setBusy(null);
    }
  };

  const loadRawSpaceKey = async (): Promise<{
    rawSpaceKey: Uint8Array;
    keyVersion: number;
  }> => {
    if (!privateKey) {
      setModalOpen(true);
      throw new Error("Unlock your vault before uploading to this organization");
    }

    const data = await readJson<{ grants: SpaceKeyGrant[] }>(
      await fetch(`/api/orgs/${orgId}/keys`),
    );
    const grant = data.grants[0];
    if (!grant) {
      throw new Error("Your organization space key is not available");
    }

    return {
      rawSpaceKey: await unwrapSpaceKeyGrant({
        wrappedSpaceKey: grant.wrappedSpaceKey,
        privateKey,
      }),
      keyVersion: grant.keyVersion,
    };
  };

  const uploadFile = async (file: File) => {
    if (!selectedBucket) {
      toast.error("Create or select a bucket first");
      return;
    }

    setBusy("upload");
    try {
      const { rawSpaceKey, keyVersion } = await loadRawSpaceKey();
      const encrypted = await encryptOrgFile({ file, rawSpaceKey });
      const opaqueName = `${crypto.randomUUID()}.bin`;
      const presign = await readJson<{
        uploadUrl: string;
        objectKey: string;
        bucketId: string;
      }>(
        await fetch(`/api/orgs/${orgId}/objects/presign-upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bucketId: selectedBucket._id,
            fileName: opaqueName,
            fileType: "application/octet-stream",
          }),
        }),
      );

      const uploadResponse = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: encrypted.encryptedBlob,
      });
      if (!uploadResponse.ok) {
        throw new Error("Encrypted upload failed");
      }

      await readJson<{ object: ObjectRow }>(
        await fetch(`/api/orgs/${orgId}/objects/complete-upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bucketId: selectedBucket._id,
            objectKey: presign.objectKey,
            size: encrypted.encryptedBlob.size,
            contentType: file.type || "application/octet-stream",
            originalContentType: file.type || "application/octet-stream",
            isEncrypted: true,
            wrappedBy: "space",
            encryptedDEK: encrypted.encryptedDEK,
            iv: encrypted.iv,
            encryptedName: encrypted.encryptedName,
            spaceKeyVersion: keyVersion,
            spaceKeyWrapIv: encrypted.spaceKeyWrapIv,
          }),
        }),
      );

      toast.success("File uploaded");
      await Promise.all([loadBuckets(), loadObjects()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void uploadFile(file);
  };

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Files</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Buckets and uploads for {orgName}. New organizations start with a shared workspace bucket.
            </p>
          </div>
          <Button variant="outline" onClick={refresh} disabled={busy !== null}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Plus className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-medium">Create bucket</h2>
            </div>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="org-bucket-name">Name</Label>
                <Input
                  id="org-bucket-name"
                  value={bucketName}
                  onChange={(event) => setBucketName(event.target.value)}
                  placeholder="team-files"
                />
              </div>
              <Button
                className="w-full"
                onClick={createBucket}
                disabled={busy !== null}
              >
                {busy === "bucket" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Database className="h-4 w-4" />
                )}
                Create
              </Button>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-medium">Buckets</h2>
            </div>
            {buckets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No buckets yet.</p>
            ) : (
              <div className="space-y-2">
                {buckets.map((bucket) => (
                  <button
                    key={bucket._id}
                    type="button"
                    onClick={() => setSelectedBucketId(bucket._id)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      selectedBucket?._id === bucket._id
                        ? "border-primary/60 bg-primary/5"
                        : "border-border hover:bg-accent/50"
                    }`}
                  >
                    <p className="truncate text-sm font-medium">{bucket.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {bucket.objectCount} files - {formatBytes(bucket.totalSizeBytes || 0)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>

        <section className="rounded-xl border border-border bg-card">
          <div className="flex flex-col gap-2 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-medium">
                {selectedBucket?.name || "Files"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {objects.length} objects
              </p>
            </div>
            {selectedBucket && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{selectedBucket._id}</Badge>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={onFileSelected}
                />
                <Button
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy !== null}
                >
                  {busy === "upload" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Upload
                </Button>
              </div>
            )}
          </div>

          {objects.length === 0 ? (
            <div className="p-8 text-sm text-muted-foreground">
              No files in this bucket.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {objects.map((object) => (
                <div
                  key={object._id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {displayObjectName(object.key)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {object.contentType} - {formatDate(object.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{formatBytes(object.size || 0)}</Badge>
                    {object.wrappedBy === "space" && (
                      <Badge variant="secondary">
                        Space key v{object.spaceKeyVersion ?? "?"}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

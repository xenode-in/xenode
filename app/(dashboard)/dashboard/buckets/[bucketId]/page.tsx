"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Upload,
  Trash2,
  FileText,
  Loader2,
  FolderOpen,
} from "lucide-react";
import Link from "next/link";

interface ObjectData {
  _id: string;
  key: string;
  size: number;
  contentType: string;
  createdAt: string;
}

interface BucketData {
  _id: string;
  name: string;
  objectCount: number;
  totalSizeBytes: number;
  region: string;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BucketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const bucketId = params.bucketId as string;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [bucket, setBucket] = useState<BucketData | null>(null);
  const [objects, setObjects] = useState<ObjectData[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [bucketRes, objectsRes] = await Promise.all([
        fetch(`/api/buckets/${bucketId}`),
        fetch(`/api/objects?bucketId=${bucketId}`),
      ]);

      const bucketData = await bucketRes.json();
      const objectsData = await objectsRes.json();

      if (!bucketRes.ok) {
        setError(bucketData.error || "Bucket not found");
        return;
      }

      setBucket(bucketData.bucket);
      setObjects(objectsData.objects || []);
    } catch {
      setError("Failed to load bucket data");
    } finally {
      setLoading(false);
    }
  }, [bucketId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setError("");

    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("bucketId", bucketId);

        const res = await fetch("/api/objects/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          setError(data.error || `Failed to upload ${file.name}`);
        }
      }

      fetchData();
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    setError("");

    try {
      const res = await fetch(`/api/objects/${deleteId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to delete object");
        return;
      }

      setDeleteId(null);
      fetchData();
    } catch {
      setError("Failed to delete object");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[#7cb686]" />
      </div>
    );
  }

  if (!bucket) {
    return (
      <div className="text-center py-20">
        <p className="text-[#e8e4d9]/50 mb-4">{error || "Bucket not found"}</p>
        <Button
          onClick={() => router.push("/dashboard/buckets")}
          variant="ghost"
          className="text-[#7cb686] hover:bg-[#7cb686]/10"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Buckets
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Link
              href="/dashboard/buckets"
              className="text-[#e8e4d9]/40 hover:text-[#e8e4d9] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-[#7cb686]" />
              <h1 className="text-2xl font-semibold text-[#e8e4d9]">
                {bucket.name}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3 ml-7">
            <Badge
              variant="secondary"
              className="bg-white/5 text-[#e8e4d9]/50 border-0 text-xs"
            >
              {bucket.region}
            </Badge>
            <span className="text-xs text-[#e8e4d9]/30">
              {bucket.objectCount} objects •{" "}
              {formatBytes(bucket.totalSizeBytes)}
            </span>
          </div>
        </div>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleUpload}
            className="hidden"
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="bg-[#7cb686] text-[#0f1a12] hover:bg-[#6ba876] font-medium"
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Upload className="w-4 h-4 mr-2" />
            )}
            Upload Files
          </Button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {/* Objects Table */}
      <div className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl overflow-hidden">
        {objects.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="border-white/5 hover:bg-transparent">
                <TableHead className="text-[#e8e4d9]/50">Name</TableHead>
                <TableHead className="text-[#e8e4d9]/50">Size</TableHead>
                <TableHead className="text-[#e8e4d9]/50">Type</TableHead>
                <TableHead className="text-[#e8e4d9]/50">Uploaded</TableHead>
                <TableHead className="text-[#e8e4d9]/50 text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {objects.map((obj) => (
                <TableRow
                  key={obj._id}
                  className="border-white/5 hover:bg-white/5"
                >
                  <TableCell>
                    <div className="flex items-center gap-2 text-[#e8e4d9]">
                      <FileText className="w-4 h-4 text-[#e8e4d9]/30" />
                      <span className="truncate max-w-[300px]">{obj.key}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-[#e8e4d9]/60">
                    {formatBytes(obj.size)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className="bg-white/5 text-[#e8e4d9]/50 border-0 text-xs"
                    >
                      {obj.contentType.split("/").pop()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[#e8e4d9]/40 text-sm">
                    {formatDate(obj.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteId(obj._id)}
                      className="text-[#e8e4d9]/40 hover:text-red-400 hover:bg-red-400/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 px-4">
            <FileText className="w-12 h-12 text-[#e8e4d9]/10 mb-4" />
            <p className="text-[#e8e4d9]/40 text-sm mb-4">
              This bucket is empty. Upload files to get started.
            </p>
            <Button
              onClick={() => fileInputRef.current?.click()}
              className="bg-[#7cb686] text-[#0f1a12] hover:bg-[#6ba876]"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Files
            </Button>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <DialogContent className="bg-[#1a2e1d] border-white/10 text-[#e8e4d9]">
          <DialogHeader>
            <DialogTitle>Delete Object</DialogTitle>
            <DialogDescription className="text-[#e8e4d9]/50">
              This will permanently delete this object. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteId(null)}
              className="text-[#e8e4d9]/60 hover:text-[#e8e4d9] hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {deleting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Delete Object
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

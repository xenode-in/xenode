"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Folder,
  FolderPlus,
  Home,
  ChevronRight,
  DownloadCloud,
} from "lucide-react";
import Link from "next/link";
import { useUpload } from "@/contexts/UploadContext";

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

  // Navigation State
  const [currentPrefix, setCurrentPrefix] = useState("");
  const [viewObjects, setViewObjects] = useState<{
    folders: string[];
    files: ObjectData[];
  }>({ folders: [], files: [] });

  // Actions State
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  // Create Folder State
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Downloading State
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Global upload context
  const { addTasks } = useUpload();

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

  // Process objects for current view
  useEffect(() => {
    const folders = new Set<string>();
    const files: ObjectData[] = [];

    objects.forEach((obj) => {
      // Must start with current prefix
      if (!obj.key.startsWith(currentPrefix)) return;
      // Don't show the directory object itself
      if (obj.key === currentPrefix) return;

      const relativeKey = obj.key.slice(currentPrefix.length);
      const parts = relativeKey.split("/");

      if (parts.length > 1 || (parts.length === 1 && obj.key.endsWith("/"))) {
        // It's a folder
        folders.add(parts[0]);
      } else {
        // It's a file
        files.push(obj);
      }
    });

    setViewObjects({
      folders: Array.from(folders).sort(),
      files: files.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    });
  }, [objects, currentPrefix]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Add files to global upload queue
    addTasks(Array.from(files), bucketId, currentPrefix);

    // Clear the input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    // Refresh data after a short delay to show uploaded files
    setTimeout(() => {
      fetchData();
    }, 1000);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    setError("");

    try {
      const res = await fetch("/api/objects/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bucketId,
          name: newFolderName,
          prefix: currentPrefix,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }

      setNewFolderName("");
      setIsCreateFolderOpen(false);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    } finally {
      setCreatingFolder(false);
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

  const handleDownload = async (obj: ObjectData) => {
    setDownloadingId(obj._id);
    try {
      const res = await fetch(`/api/objects/${obj._id}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to get download URL");
      }

      if (data.url) {
        window.open(data.url, "_blank");
      }
    } catch (err) {
      setError("Download failed");
    } finally {
      setDownloadingId(null);
    }
  };

  const navigateToFolder = (folderName: string) => {
    setCurrentPrefix((prev) => `${prev}${folderName}/`);
  };

  const navigateUp = () => {
    const parts = currentPrefix.split("/").filter(Boolean);
    parts.pop();
    setCurrentPrefix(parts.length > 0 ? `${parts.join("/")}/` : "");
  };

  const navigateToBreadcrumb = (index: number) => {
    const parts = currentPrefix.split("/").filter(Boolean);
    const newPath = parts.slice(0, index + 1).join("/");
    setCurrentPrefix(`${newPath}/`);
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

  const breadcrumbs = currentPrefix.split("/").filter(Boolean);

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

          {/* Breadcrumbs */}
          <div className="flex items-center gap-2 ml-7 mt-3 text-sm">
            <button
              onClick={() => setCurrentPrefix("")}
              className={`flex items-center hover:text-[#7cb686] transition-colors ${currentPrefix === "" ? "text-[#e8e4d9]" : "text-[#e8e4d9]/60"}`}
            >
              <Home className="w-4 h-4" />
            </button>
            {breadcrumbs.map((part, i) => (
              <div key={i} className="flex items-center gap-2">
                <ChevronRight className="w-4 h-4 text-[#e8e4d9]/30" />
                <button
                  onClick={() => navigateToBreadcrumb(i)}
                  className={`hover:text-[#7cb686] transition-colors ${i === breadcrumbs.length - 1 ? "text-[#e8e4d9] font-medium" : "text-[#e8e4d9]/60"}`}
                >
                  {part}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => setIsCreateFolderOpen(true)}
            className="bg-white/5 text-white"
          >
            <FolderPlus className="w-4 h-4 mr-2" />
            New Folder
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleUpload}
            className="hidden"
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            className="bg-[#7cb686] text-[#0f1a12] hover:bg-[#6ba876] font-medium"
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload Files
          </Button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl overflow-hidden">
        {viewObjects.folders.length === 0 && viewObjects.files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4">
            <FileText className="w-12 h-12 text-[#e8e4d9]/10 mb-4" />
            <p className="text-[#e8e4d9]/40 text-sm mb-4">
              {currentPrefix
                ? "This folder is empty."
                : "This bucket is empty."}
            </p>
            <Button
              onClick={() => fileInputRef.current?.click()}
              variant="link"
              className="text-[#7cb686]"
            >
              Upload files here
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-white/5 hover:bg-transparent">
                <TableHead className="text-[#e8e4d9]/50 w-[50%]">
                  Name
                </TableHead>
                <TableHead className="text-[#e8e4d9]/50">Size</TableHead>
                <TableHead className="text-[#e8e4d9]/50">Type</TableHead>
                <TableHead className="text-[#e8e4d9]/50">
                  Last Modified
                </TableHead>
                <TableHead className="text-[#e8e4d9]/50 text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Back Button for Subfolders */}
              {currentPrefix && (
                <TableRow
                  className="border-white/5 hover:bg-white/5 cursor-pointer"
                  onClick={navigateUp}
                >
                  <TableCell colSpan={5}>
                    <div className="flex items-center gap-2 text-[#e8e4d9]/70">
                      <ArrowLeft className="w-4 h-4" />
                      <span>..</span>
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {/* Folders */}
              {viewObjects.folders.map((folderName) => (
                <TableRow
                  key={`folder-${folderName}`}
                  className="border-white/5 hover:bg-white/5 cursor-pointer group"
                  onClick={() => navigateToFolder(folderName)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3 text-[#e8e4d9] font-medium">
                      <Folder className="w-5 h-5 text-[#7cb686] fill-[#7cb686]/20" />
                      {folderName}
                    </div>
                  </TableCell>
                  <TableCell className="text-[#e8e4d9]/40">-</TableCell>
                  <TableCell className="text-[#e8e4d9]/40">Folder</TableCell>
                  <TableCell className="text-[#e8e4d9]/40">-</TableCell>
                  <TableCell className="text-right">
                    {/* Add folder actions if needed */}
                  </TableCell>
                </TableRow>
              ))}

              {/* Files */}
              {viewObjects.files.map((obj) => (
                <TableRow
                  key={obj._id}
                  className="border-white/5 hover:bg-white/5"
                >
                  <TableCell>
                    <div className="flex items-center gap-3 text-[#e8e4d9]">
                      <FileText className="w-4 h-4 text-[#e8e4d9]/30" />
                      <span className="truncate max-w-[300px]">
                        {obj.key.replace(currentPrefix, "")}
                      </span>
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
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDownload(obj)}
                        disabled={downloadingId === obj._id}
                        className="text-[#e8e4d9]/40 hover:text-[#7cb686] hover:bg-[#7cb686]/10"
                        title="Download"
                      >
                        {downloadingId === obj._id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <DownloadCloud className="w-4 h-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteId(obj._id)}
                        className="text-[#e8e4d9]/40 hover:text-red-400 hover:bg-red-400/10"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Create Folder Dialog */}
      <Dialog open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
        <DialogContent className="bg-[#1a2e1d] border-white/10 text-[#e8e4d9]">
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription className="text-[#e8e4d9]/50">
              Enter a name for the new folder.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              className="bg-black/20 border-white/10 text-[#e8e4d9] placeholder:text-[#e8e4d9]/20"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setIsCreateFolderOpen(false)}
              className="text-[#e8e4d9]/60 hover:text-[#e8e4d9] hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateFolder}
              disabled={creatingFolder || !newFolderName.trim()}
              className="bg-[#7cb686] text-[#0f1a12] hover:bg-[#6ba876]"
            >
              {creatingFolder && (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              )}
              Create Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

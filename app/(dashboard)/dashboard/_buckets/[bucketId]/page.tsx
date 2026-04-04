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
  LayoutGrid,
  List as ListIcon,
} from "lucide-react";
import Link from "next/link";
import { useUpload } from "@/contexts/UploadContext";
import { usePreview } from "@/contexts/PreviewContext";
import { useDropzone } from "react-dropzone";
import { useCrypto } from "@/contexts/CryptoContext";
import { decryptFile } from "@/lib/crypto/fileEncryption";

interface ObjectData {
  id: string;
  key: string;
  size: number;
  contentType: string;
  createdAt: string;
  isEncrypted?: boolean;
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

  // Preview State
  const { openPreview } = usePreview();

  // View Mode State
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  // Global upload context
  const { addTasks } = useUpload();
  const { privateKey, setModalOpen } = useCrypto();

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
      setObjects(
        (objectsData.objects || []).map((o: any) => ({
          ...o,
          id: o._id || o.id,
        })),
      );
    } catch {
      setError("Failed to load bucket data");
    } finally {
      setLoading(false);
    }
  }, [bucketId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        addTasks(acceptedFiles, bucketId, currentPrefix);
        setTimeout(() => {
          fetchData();
        }, 1000);
      }
    },
    [addTasks, bucketId, currentPrefix, fetchData],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
  });

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
    setDownloadingId(obj.id);
    try {
      const res = await fetch(`/api/objects/${obj.id}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to get download URL");
      }

      if (!data.isEncrypted) {
        if (data.url) {
          window.open(data.url, "_blank");
        }
        return;
      }

      // Encrypted file handling
      if (!privateKey) {
        setModalOpen(true);
        throw new Error("Vault locked. Please unlock first.");
      }

      const ciphertextRes = await fetch(`/api/objects/${obj.id}/content`);
      if (!ciphertextRes.ok) throw new Error("Failed to download file content");
      const ciphertextBuf = await ciphertextRes.arrayBuffer();

      const decryptedBlob = await decryptFile(
        ciphertextBuf,
        data.encryptedDEK,
        data.iv,
        privateKey,
        data.contentType ?? obj.contentType,
      );

      const objectUrl = URL.createObjectURL(decryptedBlob);
      const a = document.createElement("a");
      a.href = objectUrl;
      const name = obj.key.split("/").pop() || "download";
      a.download = name;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err: any) {
      setError(err?.message || "Download failed");
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
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!bucket) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground/50 mb-4">
          {error || "Bucket not found"}
        </p>
        <Button
          onClick={() => router.push("/dashboard/buckets")}
          variant="ghost"
          className="text-primary hover:bg-primary/10"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Buckets
        </Button>
      </div>
    );
  }

  const breadcrumbs = currentPrefix.split("/").filter(Boolean);

  return (
    <div className="space-y-6" {...getRootProps()}>
      <input {...getInputProps()} />

      {/* Drag Overlay */}
      {isDragActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="p-6 rounded-full bg-primary/20 text-primary animate-bounce">
              <Upload className="w-12 h-12" />
            </div>
            <h2 className="text-3xl font-bold text-foreground">
              Drop files here
            </h2>
            <p className="text-muted-foreground">
              to upload to{" "}
              {currentPrefix ? currentPrefix : bucket?.name || "bucket"}
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Link
              href="/dashboard/buckets"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-primary" />
              <h1 className="text-2xl font-semibold text-foreground">
                {bucket && bucket.name}
              </h1>
            </div>
          </div>

          {/* Breadcrumbs */}
          <div className="flex items-center gap-2 ml-7 mt-3 text-sm">
            <button
              onClick={() => setCurrentPrefix("")}
              className={`flex items-center hover:text-primary transition-colors ${currentPrefix === "" ? "text-foreground" : "text-muted-foreground"}`}
            >
              <Home className="w-4 h-4" />
            </button>
            {breadcrumbs.map((part, i) => (
              <div key={i} className="flex items-center gap-2">
                <ChevronRight className="w-4 h-4 text-muted-foreground/30" />
                <button
                  onClick={() => navigateToBreadcrumb(i)}
                  className={`hover:text-primary transition-colors ${i === breadcrumbs.length - 1 ? "text-foreground font-medium" : "text-muted-foreground"}`}
                >
                  {part}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-secondary/50 rounded-lg p-1 mr-2 border border-border">
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 w-7 p-0 ${
                viewMode === "list"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setViewMode("list")}
            >
              <ListIcon className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 w-7 p-0 ${
                viewMode === "grid"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
          </div>

          <Button
            onClick={() => setIsCreateFolderOpen(true)}
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
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
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
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
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {viewObjects.folders.length === 0 && viewObjects.files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4">
            <FileText className="w-12 h-12 text-muted-foreground/20 mb-4" />
            <p className="text-muted-foreground text-sm mb-4">
              {currentPrefix
                ? "This folder is empty."
                : "This bucket is empty."}
            </p>
            <Button
              onClick={() => fileInputRef.current?.click()}
              variant="link"
              className="text-primary"
            >
              Upload files here
            </Button>
          </div>
        ) : viewMode === "list" ? (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground w-[50%]">
                  Name
                </TableHead>
                <TableHead className="text-muted-foreground">Size</TableHead>
                <TableHead className="text-muted-foreground">Type</TableHead>
                <TableHead className="text-muted-foreground">
                  Last Modified
                </TableHead>
                <TableHead className="text-muted-foreground text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Back Button for Subfolders */}
              {currentPrefix && (
                <TableRow
                  className="border-border hover:bg-secondary/50 cursor-pointer"
                  onClick={navigateUp}
                >
                  <TableCell colSpan={5}>
                    <div className="flex items-center gap-2 text-muted-foreground">
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
                  className="border-border hover:bg-secondary/50 cursor-pointer group"
                  onClick={() => navigateToFolder(folderName)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3 text-foreground font-medium">
                      <Folder className="w-5 h-5 text-primary fill-primary/20" />
                      {folderName}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">-</TableCell>
                  <TableCell className="text-muted-foreground">
                    Folder
                  </TableCell>
                  <TableCell className="text-muted-foreground">-</TableCell>
                  <TableCell className="text-right">
                    {/* Add folder actions if needed */}
                  </TableCell>
                </TableRow>
              ))}

              {/* Files */}
              {viewObjects.files.map((obj) => (
                <TableRow
                  key={obj.id}
                  className="border-border hover:bg-secondary/50 cursor-pointer"
                  onClick={() => openPreview(obj, viewObjects.files)}
                  onDoubleClick={() => openPreview(obj, viewObjects.files)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3 text-foreground">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span className="truncate max-w-[300px]">
                        {obj.key.replace(currentPrefix, "")}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatBytes(obj.size)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className="bg-secondary text-muted-foreground border-0 text-xs"
                    >
                      {obj.contentType.split("/").pop()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(obj.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          openPreview(obj, viewObjects.files);
                        }}
                        className="text-muted-foreground hover:text-primary hover:bg-primary/10"
                        title="Preview"
                      >
                        <FileText className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(obj);
                        }}
                        disabled={downloadingId === obj.id}
                        className="text-muted-foreground hover:text-primary hover:bg-primary/10"
                        title="Download"
                      >
                        {downloadingId === obj.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <DownloadCloud className="w-4 h-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteId(obj.id);
                        }}
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
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
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 p-4">
            {/* Back Button for Subfolders */}
            {currentPrefix && (
              <div
                onClick={navigateUp}
                className="aspect-square bg-secondary/50 rounded-xl border border-secondary flex flex-col items-center justify-center cursor-pointer hover:bg-secondary transition-all hover:scale-[1.02]"
              >
                <ArrowLeft className="w-8 h-8 text-muted-foreground mb-2" />
                <span className="text-foreground/70 font-medium text-sm">
                  Back
                </span>
              </div>
            )}

            {/* Folders */}
            {viewObjects.folders.map((folderName) => (
              <div
                key={`folder-${folderName}`}
                onClick={() => navigateToFolder(folderName)}
                className="aspect-square bg-card rounded-xl border border-border flex flex-col items-center justify-center cursor-pointer hover:bg-secondary/50 transition-all hover:scale-[1.02] p-4 group"
              >
                <Folder className="w-12 h-12 text-primary mb-3 fill-primary/20 transition-transform group-hover:scale-110" />
                <span className="text-foreground font-medium text-sm text-center truncate w-full px-2">
                  {folderName}
                </span>
                <span className="text-muted-foreground text-xs mt-1">
                  Folder
                </span>
              </div>
            ))}

            {/* Files */}
            {viewObjects.files.map((obj) => (
              <div
                key={obj.id}
                onDoubleClick={() => openPreview(obj, viewObjects.files)}
                onClick={() => openPreview(obj, viewObjects.files)}
                className="group relative aspect-square bg-card rounded-xl border border-border flex flex-col items-center justify-center cursor-pointer hover:bg-secondary/50 transition-all hover:scale-[1.02] overflow-hidden"
              >
                {/* Icon/Thumbnail */}
                <div className="flex-1 flex items-center justify-center w-full p-4 pb-0">
                  {obj.contentType.startsWith("image/") ? (
                    <div className="relative w-full h-full flex items-center justify-center">
                      <FileText className="w-10 h-10 text-primary" />
                    </div>
                  ) : obj.contentType.startsWith("video/") ? (
                    <div className="relative w-full h-full flex items-center justify-center">
                      <FileText className="w-10 h-10 text-primary" />
                    </div>
                  ) : (
                    <FileText className="w-10 h-10 text-muted-foreground/30 group-hover:text-primary transition-colors" />
                  )}
                </div>

                {/* Footer Info */}
                <div className="w-full bg-black/20 p-3 flex flex-col gap-0.5 mt-2">
                  <span className="text-foreground text-xs font-medium truncate w-full text-center px-1">
                    {obj.key.replace(currentPrefix, "")}
                  </span>
                  <span className="text-muted-foreground text-[10px] text-center">
                    {formatBytes(obj.size)}
                  </span>
                </div>

                {/* Action Overlay */}
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 rounded-md bg-black/50 hover:bg-primary hover:text-primary-foreground text-foreground backdrop-blur-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      openPreview(obj, viewObjects.files);
                    }}
                    title="Preview"
                  >
                    <FileText className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 rounded-md bg-black/50 hover:bg-primary hover:text-primary-foreground text-foreground backdrop-blur-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(obj);
                    }}
                    disabled={downloadingId === obj.id}
                    title="Download"
                  >
                    {downloadingId === obj.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <DownloadCloud className="w-3.5 h-3.5" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 rounded-md bg-black/50 hover:bg-destructive hover:text-destructive-foreground text-foreground backdrop-blur-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteId(obj.id);
                    }}
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Folder Dialog */}
      <Dialog open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Enter a name for the new folder.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              className="bg-secondary/50 border-border text-foreground placeholder:text-muted-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setIsCreateFolderOpen(false)}
              className="text-muted-foreground hover:text-foreground hover:bg-secondary"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateFolder}
              disabled={creatingFolder || !newFolderName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
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
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle>Delete Object</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This will permanently delete this object. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteId(null)}
              className="text-muted-foreground hover:text-foreground hover:bg-secondary"
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

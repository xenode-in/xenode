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
  Tag,
  Scissors,
  ClipboardPaste,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useUpload } from "@/contexts/UploadContext";
import { useDropzone } from "react-dropzone";
import dynamic from "next/dynamic";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { FileItem, FileRow, FileCard } from "@/components/dashboard/FileItem";
import { formatBytes, formatDate } from "@/lib/utils";

const FilePreviewDialog = dynamic(
  () =>
    import("@/components/dashboard/FilePreviewDialog").then(
      (mod) => mod.FilePreviewDialog,
    ),
  { ssr: false },
);

interface ObjectData {
  _id: string;
  key: string;
  size: number;
  contentType: string;
  createdAt: string;
  tags?: string[];
  position?: number;
}

interface BucketData {
  _id: string;
  name: string;
  objectCount: number;
  totalSizeBytes: number;
  region: string;
  createdAt: string;
}

export default function FilesPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [bucketId, setBucketId] = useState<string | null>(null);
  const [bucket, setBucket] = useState<BucketData | null>(null);
  const [rootPrefix, setRootPrefix] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const fetchData = useCallback(async () => {
    if (!bucketId) return;

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

  // Fetch global bucket ID and root prefix
  useEffect(() => {
    fetch("/api/drive/config")
      .then((res) => res.json())
      .then((data) => {
        if (data.bucket) {
          setBucketId(data.bucket._id);
          if (data.rootPrefix) {
            setCurrentPrefix(data.rootPrefix);
            setRootPrefix(data.rootPrefix);
          }
        } else {
          setError("Failed to initialize drive storage");
        }
      })
      .catch((err) => {
        console.error(err);
        setError("Failed to connect to storage");
      });
  }, []);
  const [objects, setObjects] = useState<ObjectData[]>([]);
  const [loading, setLoading] = useState(true);

  // Navigation State
  const [currentPrefix, setCurrentPrefix] = useState("");
  const [viewObjects, setViewObjects] = useState<{
    folders: ObjectData[];
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
  const [previewFile, setPreviewFile] = useState<ObjectData | null>(null);

  // Tagging State
  const [taggingObj, setTaggingObj] = useState<ObjectData | null>(null);
  const [newTag, setNewTag] = useState("");

  // Clipboard State (for Move)
  const [clipboard, setClipboard] = useState<{
    action: "move";
    items: ObjectData[];
  } | null>(null);
  const [processingPaste, setProcessingPaste] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(null);

  // DnD Sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts (prevents click hijack)
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) return;

    // Determine if folder or file
    const isFolder = viewObjects.folders.some((f) => f._id === active.id);
    const isFile = viewObjects.files.some((f) => f._id === active.id);

    if (isFolder) {
      const oldIndex = viewObjects.folders.findIndex(
        (f) => f._id === active.id,
      );
      const newIndex = viewObjects.folders.findIndex((f) => f._id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        // Optimistic update
        const newFolders = arrayMove(viewObjects.folders, oldIndex, newIndex);
        setViewObjects({ ...viewObjects, folders: newFolders });

        // Persist
        try {
          // Calculate new positions for ALL affected items or just swap?
          // ArrayMove just moves.
          // We typically assign position = index.
          const updates = newFolders
            .map((item, index) => ({
              id: item._id,
              position: index,
            }))
            .filter((item) => !item.id.startsWith("virtual-")); // Skip virtual

          if (updates.length > 0) {
            const res = await fetch("/api/objects/reorder", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ bucketId, items: updates }),
            });
            if (!res.ok) {
              const errData = await res.json();
              console.error("Reorder failed response:", errData);
            } else {
              console.log("Reorder success");
            }
          }
        } catch (err) {
          console.error("Failed to reorder folders", err);
        }
      }
    } else if (isFile) {
      const oldIndex = viewObjects.files.findIndex((f) => f._id === active.id);
      const newIndex = viewObjects.files.findIndex((f) => f._id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newFiles = arrayMove(viewObjects.files, oldIndex, newIndex);
        setViewObjects({ ...viewObjects, files: newFiles });

        try {
          const updates = newFiles.map((item, index) => ({
            id: item._id,
            position: index,
          }));

          if (updates.length > 0) {
            const res = await fetch("/api/objects/reorder", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ bucketId, items: updates }),
            });
            if (!res.ok) {
              const errData = await res.json();
              console.error("Reorder failed response:", errData);
            } else {
              console.log("Reorder success");
            }
          }
        } catch (err) {
          console.error("Failed to reorder files", err);
        }
      }
    }
  };

  const handleCut = (obj: ObjectData) => {
    setClipboard({ action: "move", items: [obj] });
  };

  const handlePaste = async () => {
    if (!clipboard || !bucketId) return;
    setProcessingPaste(true);

    try {
      const res = await fetch("/api/objects/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bucketId,
          sourceKeys: clipboard.items.map((i) => i.key),
          destinationPrefix: currentPrefix,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setClipboard(null);
        fetchData();
        // Optional: show toast success
      } else {
        console.error("Move failed", data);
        setError(data.error || "Failed to move items");
      }
    } catch (err) {
      console.error(err);
      setError("Failed to move items");
    } finally {
      setProcessingPaste(false);
    }
  };

  const handleAddTag = async () => {
    if (!taggingObj || !newTag.trim()) return;
    const currentTags = taggingObj.tags || [];
    if (currentTags.includes(newTag.trim())) {
      setNewTag("");
      return;
    }
    const updatedTags = [...currentTags, newTag.trim()];

    try {
      const res = await fetch(`/api/objects/${taggingObj._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: updatedTags }),
      });

      if (res.ok) {
        setTaggingObj({ ...taggingObj, tags: updatedTags });
        setNewTag("");
        fetchData(); // Refresh list headers
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!taggingObj) return;
    const currentTags = taggingObj.tags || [];
    const updatedTags = currentTags.filter((t) => t !== tagToRemove);

    try {
      const res = await fetch(`/api/objects/${taggingObj._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: updatedTags }),
      });

      if (res.ok) {
        setTaggingObj({ ...taggingObj, tags: updatedTags });
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // View Mode State
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  useEffect(() => {
    const savedView = localStorage.getItem("filesViewMode");
    if (savedView === "list" || savedView === "grid") {
      setViewMode(savedView);
    }
  }, []);

  const toggleViewMode = (mode: "list" | "grid") => {
    setViewMode(mode);
    localStorage.setItem("filesViewMode", mode);
  };

  // Global upload context
  const { addTasks, tasks } = useUpload();

  // Track completed uploads to trigger refresh
  const prevCompletedCountRef = useRef(0);

  // Refresh when uploads complete
  useEffect(() => {
    if (!bucketId) return;

    // Count completed uploads for CURRENT folder
    const completedCount = tasks.filter(
      (t) =>
        t.bucketId === bucketId &&
        t.prefix === currentPrefix &&
        t.status === "completed",
    ).length;

    // If count increased, it means a new upload finished
    if (completedCount > prevCompletedCountRef.current) {
      fetchData();
    }

    prevCompletedCountRef.current = completedCount;
  }, [tasks, bucketId, currentPrefix, fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0 && bucketId) {
        addTasks(Array.from(acceptedFiles), bucketId, currentPrefix);
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
    const folderMap = new Map<string, ObjectData>();
    const files: ObjectData[] = [];

    objects.forEach((obj) => {
      // Must start with current prefix
      if (!obj.key.startsWith(currentPrefix)) return;
      // Don't show the directory object itself (if it matches exactly)
      if (obj.key === currentPrefix) return;

      const relativeKey = obj.key.slice(currentPrefix.length);
      const parts = relativeKey.split("/");

      if (parts.length > 1 || (parts.length === 1 && obj.key.endsWith("/"))) {
        // It's a folder (or inside one)
        const folderName = parts[0];

        // Check if we already have this folder
        if (!folderMap.has(folderName)) {
          // Try to find the actual folder object (endsWith "/")
          const folderKey = `${currentPrefix}${folderName}/`;
          const folderObj = objects.find((o) => o.key === folderKey);

          if (folderObj) {
            folderMap.set(folderName, folderObj);
          } else {
            // Virtual folder
            folderMap.set(folderName, {
              _id: `virtual-${folderName}`,
              key: folderKey,
              size: 0,
              contentType: "application/x-directory",
              createdAt: new Date().toISOString(), // Mock
              tags: [],
            });
          }
        }
      } else {
        // It's a file
        files.push(obj);
      }
    });

    const sortFolders = (a: ObjectData, b: ObjectData) => {
      if (a.position !== undefined || b.position !== undefined) {
        const posA = a.position ?? Number.MAX_SAFE_INTEGER;
        const posB = b.position ?? Number.MAX_SAFE_INTEGER;
        if (posA !== posB) return posA - posB;
      }
      return a.key.localeCompare(b.key);
    };

    const sortFiles = (a: ObjectData, b: ObjectData) => {
      if (a.position !== undefined || b.position !== undefined) {
        const posA = a.position ?? Number.MAX_SAFE_INTEGER;
        const posB = b.position ?? Number.MAX_SAFE_INTEGER;
        if (posA !== posB) return posA - posB;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    };

    setViewObjects({
      folders: Array.from(folderMap.values()).sort(sortFolders),
      files: files.sort(sortFiles),
    });
  }, [objects, currentPrefix]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !bucketId) return;

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
    if (!newFolderName.trim() || !bucketId) return;
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
    if (currentPrefix === rootPrefix) return;
    const parts = currentPrefix.split("/").filter(Boolean);
    parts.pop();
    const newPath = parts.length > 0 ? `${parts.join("/")}/` : "";
    // Ensure we don't go below rootPrefix
    if (newPath.length < rootPrefix.length) {
      setCurrentPrefix(rootPrefix);
    } else {
      setCurrentPrefix(newPath);
    }
  };

  const navigateToBreadcrumb = (index: number) => {
    // breadcrumbs derived relative to rootPrefix
    const relativePrefix = currentPrefix.slice(rootPrefix.length);
    const parts = relativePrefix.split("/").filter(Boolean);
    const newRelativePath = parts.slice(0, index + 1).join("/");
    setCurrentPrefix(`${rootPrefix}${newRelativePath}/`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[#7cb686]" />
      </div>
    );
  }

  if (!bucket) {
    if (loading || !bucketId) {
      return (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-[#7cb686]" />
        </div>
      );
    }
    return (
      <div className="text-center py-20">
        <p className="text-[#e8e4d9]/50 mb-4">
          {error || "Drive inaccessible"}
        </p>
        <Button
          onClick={() => window.location.reload()}
          variant="ghost"
          className="text-[#7cb686] hover:bg-[#7cb686]/10"
        >
          Retry
        </Button>
      </div>
    );
  }

  const relativePrefix = currentPrefix.startsWith(rootPrefix)
    ? currentPrefix.slice(rootPrefix.length)
    : currentPrefix;
  const breadcrumbs = relativePrefix.split("/").filter(Boolean);

  const folderIds = viewObjects.folders.map((f) => f._id);
  const fileIds = viewObjects.files.map((f) => f._id);

  return (
    <div
      className="space-y-6 relative h-full min-h-[calc(100vh-100px)] outline-none"
      {...getRootProps()}
    >
      <input {...getInputProps()} />

      {/* Drop Zone Overlay */}
      {isDragActive && (
        <div className="absolute inset-0 z-50 bg-[#0f1a12]/90 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-[#7cb686] rounded-xl transition-all duration-200">
          <div className="flex flex-col items-center gap-4">
            <div className="p-6 bg-[#7cb686]/10 rounded-full animate-bounce">
              <Upload className="w-12 h-12 text-[#7cb686]" />
            </div>
            <p className="text-2xl font-medium text-[#e8e4d9]">
              Drop files to upload
            </p>
            <p className="text-[#e8e4d9]/50">
              Release to start uploading to this folder
            </p>
          </div>
        </div>
      )}

      {/* ... Drag Overlay ... */}

      {/* Header */}
      <div className="flex lg:flex-row items-start lg:items-start justify-between gap-4">
        <div className="w-full lg:w-auto">
          {/* ... */}

          {/* Breadcrumbs */}
          <div className="flex items-center gap-2 ml-3 lg:ml-7 mt-3 text-sm overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setCurrentPrefix(rootPrefix)}
              className={`flex items-center hover:text-[#7cb686] transition-colors flex-shrink-0 ${
                currentPrefix === rootPrefix
                  ? "text-[#e8e4d9]"
                  : "text-[#e8e4d9]/60"
              }`}
            >
              <Home className="w-4 h-4" />
            </button>
            {breadcrumbs.map((part, i) => (
              <div key={i} className="flex items-center gap-2 flex-shrink-0">
                <ChevronRight className="w-4 h-4 text-[#e8e4d9]/30" />
                <button
                  onClick={() => navigateToBreadcrumb(i)}
                  className={`hover:text-[#7cb686] transition-colors whitespace-nowrap ${
                    i === breadcrumbs.length - 1
                      ? "text-[#e8e4d9] font-medium"
                      : "text-[#e8e4d9]/60"
                  }`}
                >
                  {part}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 lg:gap-3 w-full lg:w-auto">
          {/* View Mode Toggle - Hidden on mobile */}
          <div className="hidden sm:flex items-center bg-white/5 rounded-lg p-1 mr-2 border border-white/5">
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 w-7 p-0 ${
                viewMode === "list"
                  ? "bg-white/10 text-[#e8e4d9]"
                  : "text-[#e8e4d9]/40 hover:text-[#e8e4d9]"
              }`}
              onClick={() => toggleViewMode("list")}
            >
              <ListIcon className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 w-7 p-0 ${
                viewMode === "grid"
                  ? "bg-white/10 text-[#e8e4d9]"
                  : "text-[#e8e4d9]/40 hover:text-[#e8e4d9]"
              }`}
              onClick={() => toggleViewMode("grid")}
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
          </div>

          {/* Paste Button */}
          {clipboard && (
            <Button
              onClick={handlePaste}
              disabled={processingPaste}
              className="bg-[#7cb686] text-[#0f1a12] hover:bg-[#6ba876] flex-shrink-0"
              size="sm"
            >
              {processingPaste ? (
                <Loader2 className="w-4 h-4 sm:mr-2 animate-spin" />
              ) : (
                <ClipboardPaste className="w-4 h-4 sm:mr-2" />
              )}
              <span className="hidden sm:inline">
                Paste {clipboard.items.length} Item(s)
              </span>
            </Button>
          )}

          {/* New Folder Button */}
          <Button
            onClick={() => setIsCreateFolderOpen(true)}
            className="bg-white/5 text-white flex-shrink-0"
            size="sm"
          >
            <FolderPlus className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">New Folder</span>
          </Button>

          {/* Upload Files Button */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleUpload}
            className="hidden"
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            className="bg-[#7cb686] text-[#0f1a12] hover:bg-[#6ba876] font-medium flex-shrink-0"
            size="sm"
          >
            <Upload className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Upload Files</span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {/* Table / Grid */}
      <div className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl overflow-hidden min-h-[500px]">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {viewObjects.folders.length === 0 &&
          viewObjects.files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-4 h-full">
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
          ) : viewMode === "list" ? (
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
                {currentPrefix && currentPrefix !== rootPrefix && (
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

                <SortableContext
                  items={folderIds}
                  strategy={verticalListSortingStrategy}
                >
                  {viewObjects.folders.map((folder) => (
                    <FileItem
                      key={folder._id}
                      item={folder}
                      viewMode="list"
                      currentPrefix={currentPrefix}
                      onNavigate={navigateToFolder}
                      onTag={() => setTaggingObj(folder)}
                      onCut={handleCut}
                      onDelete={(item) => setDeleteId(item._id)}
                    />
                  ))}
                </SortableContext>

                <SortableContext
                  items={fileIds}
                  strategy={verticalListSortingStrategy}
                >
                  {viewObjects.files.map((file) => (
                    <FileItem
                      key={file._id}
                      item={file}
                      viewMode="list"
                      currentPrefix={currentPrefix}
                      onPreview={setPreviewFile}
                      onDownload={handleDownload}
                      onCut={handleCut}
                      onDelete={(item) => setDeleteId(item._id)}
                      isDownloading={downloadingId === file._id}
                    />
                  ))}
                </SortableContext>
              </TableBody>
            </Table>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 p-4">
              {/* Back Button for Subfolders */}
              {currentPrefix && currentPrefix !== rootPrefix && (
                <div
                  onClick={navigateUp}
                  className="aspect-square bg-white/5 rounded-xl border border-white/5 flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 transition-all hover:scale-[1.02]"
                >
                  <ArrowLeft className="w-8 h-8 text-[#e8e4d9]/50 mb-2" />
                  <span className="text-[#e8e4d9]/70 font-medium text-sm">
                    Back
                  </span>
                </div>
              )}

              <SortableContext items={folderIds} strategy={rectSortingStrategy}>
                {viewObjects.folders.map((folder) => (
                  <FileItem
                    key={folder._id}
                    item={folder}
                    viewMode="grid"
                    currentPrefix={currentPrefix}
                    onNavigate={navigateToFolder}
                    onTag={() => setTaggingObj(folder)}
                    onCut={handleCut}
                    onDelete={(item) => setDeleteId(item._id)}
                  />
                ))}
              </SortableContext>

              <SortableContext items={fileIds} strategy={rectSortingStrategy}>
                {viewObjects.files.map((file) => (
                  <FileItem
                    key={file._id}
                    item={file}
                    viewMode="grid"
                    currentPrefix={currentPrefix}
                    onPreview={setPreviewFile}
                    onDownload={handleDownload}
                    onCut={handleCut}
                    onDelete={(item) => setDeleteId(item._id)}
                    isDownloading={downloadingId === file._id}
                  />
                ))}
              </SortableContext>
            </div>
          )}
          <DragOverlay>
            {activeId
              ? (() => {
                  const item =
                    viewObjects.folders.find((f) => f._id === activeId) ||
                    viewObjects.files.find((f) => f._id === activeId);
                  if (!item) return null;
                  if (viewMode === "list")
                    return (
                      <FileRow
                        item={item}
                        viewMode="list"
                        currentPrefix={currentPrefix}
                        isOverlay={true}
                      />
                    );
                  return (
                    <FileCard
                      item={item}
                      viewMode="grid"
                      currentPrefix={currentPrefix}
                      isOverlay={true}
                    />
                  );
                })()
              : null}
          </DragOverlay>
        </DndContext>
      </div>

      <FilePreviewDialog
        file={previewFile}
        isOpen={!!previewFile}
        onClose={() => setPreviewFile(null)}
      />

      <Dialog
        open={!!taggingObj}
        onOpenChange={(open) => !open && setTaggingObj(null)}
      >
        <DialogContent className="bg-[#0f1a12] border-white/10 text-[#e8e4d9]">
          <DialogHeader>
            <DialogTitle>Manage Tags</DialogTitle>
            <DialogDescription className="text-[#e8e4d9]/50">
              Add or remove tags for this item.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2 mb-4">
            <Input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Add a tag..."
              className="bg-white/5 border-white/10 focus:border-[#7cb686]"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
            />
            <Button
              onClick={handleAddTag}
              className="bg-[#7cb686] hover:bg-[#6ba876] text-[#0f1a12]"
            >
              Add
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 min-h-[50px] bg-white/5 rounded-lg p-3">
            {taggingObj?.tags && taggingObj.tags.length > 0 ? (
              taggingObj.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="bg-[#1a2e1d] text-[#7cb686] hover:bg-[#1a2e1d] flex gap-1 items-center pl-2 pr-1 py-1"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-red-400 p-0.5 rounded-full hover:bg-white/5"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </Badge>
              ))
            ) : (
              <span className="text-[#e8e4d9]/30 text-sm italic">
                No tags yet
              </span>
            )}
          </div>
        </DialogContent>
      </Dialog>

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

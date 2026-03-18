"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
  X,
  Share2,
} from "lucide-react";
import Link from "next/link";
import { ShareDialog, ShareableFile } from "@/components/share-dialog";
import { useUpload } from "@/contexts/UploadContext";
import { useCrypto } from "@/contexts/CryptoContext";
import { useDownload } from "@/contexts/DownloadContext";
import { usePreview } from "@/contexts/PreviewContext";
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

interface ObjectData {
  id: string; // use id, not _id
  key: string;
  size: number;
  contentType: string;
  createdAt: string;
  tags?: string[];
  position?: number;
  thumbnail?: string;
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

export default function FilesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map());

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

  // Fetch global bucket ID and root prefix
  useEffect(() => {
    fetch("/api/drive/config")
      .then((res) => res.json())
      .then((data) => {
        if (data.bucket) {
          setBucketId(data.bucket._id);
          if (data.rootPrefix) {
            const folderParam = searchParams.get("folder");
            if (folderParam) {
              setCurrentPrefix(data.rootPrefix + folderParam);
            } else {
              setCurrentPrefix(data.rootPrefix);
            }
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

  const handleNavigation = useCallback((newPrefix: string) => {
    setCurrentPrefix(newPrefix);
    if (newPrefix === rootPrefix) {
      router.push('/dashboard/files');
    } else {
      const relative = newPrefix.slice(rootPrefix.length);
      router.push(`/dashboard/files?folder=${encodeURIComponent(relative)}`);
    }
  }, [rootPrefix, router]);

  // Sync URL changes to currentPrefix when user uses back/forward buttons
  useEffect(() => {
    if (!rootPrefix) return;
    const folderParam = searchParams.get("folder");
    const expectedPrefix = folderParam ? `${rootPrefix}${folderParam}` : rootPrefix;
    if (currentPrefix !== expectedPrefix) {
      setCurrentPrefix(expectedPrefix);
    }
  }, [searchParams, rootPrefix]);
  const viewObjects = useMemo(() => {
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
              id: `virtual-${folderName}`,
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

    return {
      folders: Array.from(folderMap.values()).sort(sortFolders),
      files: files.sort(sortFiles),
    };
  }, [objects, currentPrefix]);

  // Actions State
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  // Create Folder State
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Downloading State
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Preview State
  const { openPreview, closePreview } = usePreview();

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

  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

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

  const handleSelect = useCallback(
    (item: ObjectData, e: React.MouseEvent) => {
      const id = item.id;
      e.stopPropagation();
      e.preventDefault();

      const newSelected = new Set(selectedIds);

      if (e.ctrlKey || e.metaKey) {
        // Toggle selection
        if (newSelected.has(id)) {
          newSelected.delete(id);
        } else {
          newSelected.add(id);
          setLastSelectedId(id);
        }
      } else if (e.shiftKey && lastSelectedId) {
        // Range select
        const allItems = [...viewObjects.folders, ...viewObjects.files];
        const lastIndex = allItems.findIndex(
          (item) => item.id === lastSelectedId,
        );
        const currentIndex = allItems.findIndex((item) => item.id === id);

        if (lastIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(lastIndex, currentIndex);
          const end = Math.max(lastIndex, currentIndex);
          const range = allItems.slice(start, end + 1);

          // Add range to existing selection if CTRL is also held? No, standard behavior is clear others.
          // Unless we want to behave like Windows Explorer which keeps Ctrl pressed.
          // For simple Shift+Click, we clear and select range.
          newSelected.clear();
          range.forEach((item) => newSelected.add(item.id));
        }
      } else {
        // Single select
        newSelected.clear();
        newSelected.add(id);
        setLastSelectedId(id);
      }

      setSelectedIds(newSelected);
    },
    [selectedIds, lastSelectedId, viewObjects],
  );

  // Clear selection when clicking background
  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setSelectedIds(new Set());
      setLastSelectedId(null);
    }
  };

  // Cache for item rects to prevent layout thrashing during drag
  const dragStartRects = useRef<Map<string, DOMRect>>(new Map());
  const rafId = useRef<number | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;

    // If clicked directly on an item, do NOT start box selection
    if (target.closest(".file-item-selectable")) return;

    setIsSelecting(true);
    setSelectionBox({
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
    });

    // Clear selection when starting a new box (unless Ctrl is held)
    if (!e.ctrlKey) setSelectedIds(new Set());

    // Cache all item rects once at start of drag
    dragStartRects.current.clear();
    for (const [id, el] of itemRefs.current.entries()) {
      if (document.body.contains(el)) {
        dragStartRects.current.set(id, el.getBoundingClientRect());
      }
    }
  };

  function rectsIntersect(
    a: DOMRect,
    b: { left: number; top: number; right: number; bottom: number },
  ) {
    return !(
      a.right < b.left ||
      a.left > b.right ||
      a.bottom < b.top ||
      a.top > b.bottom
    );
  }

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isSelecting || !selectionBox) return;

      const clientX = e.clientX;
      const clientY = e.clientY;

      // Throttle updates with requestAnimationFrame
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }

      rafId.current = requestAnimationFrame(() => {
        setSelectionBox((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            currentX: clientX,
            currentY: clientY,
          };
        });

        // Use the event coordinates directly for the calculation logic
        // to avoid waiting for state update cycle
        const newBox = {
          startX: selectionBox.startX,
          startY: selectionBox.startY,
          currentX: clientX,
          currentY: clientY,
        };

        const boxRect = {
          left: Math.min(newBox.startX, newBox.currentX),
          right: Math.max(newBox.startX, newBox.currentX),
          top: Math.min(newBox.startY, newBox.currentY),
          bottom: Math.max(newBox.startY, newBox.currentY),
        };

        const nextSelected = new Set<string>();

        // Use cached rects instead of querying DOM
        for (const [id, rect] of dragStartRects.current.entries()) {
          if (rectsIntersect(rect, boxRect)) {
            nextSelected.add(id);
          }
        }

        setSelectedIds((prev) => {
          // Only update if selection actually changed
          if (prev.size === nextSelected.size) {
            let eq = true;
            for (const id of nextSelected) {
              if (!prev.has(id)) {
                eq = false;
                break;
              }
            }
            if (eq) return prev;
          }
          return nextSelected;
        });
      });
    },
    [isSelecting, selectionBox],
  );

  const handleMouseUp = () => {
    if (isSelecting) {
      setIsSelecting(false);
      setSelectionBox(null);
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      dragStartRects.current.clear();
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as string;
    setActiveId(id);

    // If dragging an item NOT in selection, select it and clear others
    if (
      !selectedIds.has(id) &&
      !event.active.data.current?.sortable?.items?.includes(id)
    ) {
      // Logic: if user drags an unselected item, usually that becomes the selection.
      // But if CTRL is held? Drag event usually suppresses click.
      // Let's assume standard behavior: drag unselected = select only that one.
      setSelectedIds(new Set([id]));
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) return;

    // Items to move: all selected IDs
    // If active ID is not in selected set (shouldn't happen due to DragStart logic, but safety check)
    // we use just active ID.
    const itemsToMoveIds = selectedIds.has(active.id as string)
      ? Array.from(selectedIds)
      : [active.id as string];

    // Determine context (Folders or Files)
    // We assume we don't drag mix of folders/files for reordering usually,
    // or if we do, we handle them in their respective lists.
    // Simplifying assumption: We only reorder within the same Type since we have two SortableContexts.
    // If I drag a File, it can only be dropped on a File in this setup usually, unless we unify.
    // Wait, SortableContext items are separated.

    // Check if active item is folder or file
    const isFolder = viewObjects.folders.some((f) => f.id === active.id);
    const isFile = viewObjects.files.some((f) => f.id === active.id);

    const list = isFolder ? viewObjects.folders : viewObjects.files;

    if (
      (isFolder && !viewObjects.folders.some((f) => f.id === over.id)) ||
      (isFile && !viewObjects.files.some((f) => f.id === over.id))
    ) {
      // Dropped on different type?
      // If we support mixed reordering, we need a unified list.
      // Current UI has separate prompts. We'll stick to same-type reordering for now.
      return;
    }

    // Filter out items to move from the list to get the "base" list
    const baseList = list.filter((item) => !itemsToMoveIds.includes(item.id));

    // Find index of `over` item in the original list
    const overIndexOriginal = list.findIndex((item) => item.id === over.id);
    // But `over` item might be one of the moving items?
    // If I drag selection onto itself, usually nothing happens or specific reorder.
    if (itemsToMoveIds.includes(over.id as string)) return;

    // We need the index of `over` in the *base* list to know where to insert?
    // Actually, `dnd-kit` gives us `over`.
    // If we drag A,B to C. C is in base list.
    // We want to insert A,B after or before C.
    // Simpler: Find index of `over` in `list`.
    // If we move down, we insert after. If up, before.
    // Since we are removing items, indices shift.

    // Let's use `dnd-kit`'s approach:
    // When dragging, `over` is the target.
    // New index logic:
    const overIndex = list.findIndex((f) => f.id === over.id);
    const activeIndex = list.findIndex((f) => f.id === active.id);

    // Implementation:
    // 1. Remove items from list.
    // 2. Insert at new index.
    // Careful with index shifting.

    let newItems = [...list];
    // Sort items to move by their current index to maintain relative order?
    // or just move them as a block? usually block.
    // But if they are non-contiguous? Explorer usually gathers them.

    const movingItems = itemsToMoveIds
      .map((id) => list.find((item) => item.id === id))
      .filter(Boolean) as ObjectData[];

    // Remove
    newItems = newItems.filter((item) => !itemsToMoveIds.includes(item.id));

    // Find new insertion index
    // We want to insert where `over` is.
    // But `over` is in `newItems`? Yes, because we checked `!itemsToMoveIds.includes(over.id)`.
    const newOverIndex = newItems.findIndex((item) => item.id === over.id);

    // visual quirk: if we drag from top to bottom, usually we insert AFTER over.
    // if bottom to top, BEFORE over.
    // But `arrayMove` handles this via indices.
    // Since we removed items, `newOverIndex` is the spot.
    // If original activeIndex < overIndex, we moved down.

    const modifier = activeIndex < overIndex ? 1 : 0;
    // This valid for single item. for multiple?
    // Let's just insert at `newOverIndex` + modifier.

    newItems.splice(newOverIndex + modifier, 0, ...movingItems);

    // Update global objects state with new positions
    setObjects((prev) => {
      const next = [...prev];
      const positionMap = new Map<string, number>();

      newItems.forEach((item, index) => {
        positionMap.set(item.id, index);
      });

      for (let i = 0; i < next.length; i++) {
        const obj = next[i];
        if (positionMap.has(obj.id)) {
          next[i] = { ...obj, position: positionMap.get(obj.id) };
        }
      }

      return next;
    });

    // Persist
    try {
      const updates = newItems
        .map((item, index) => ({
          id: item.id,
          position: index,
        }))
        .filter((item) => !item.id.startsWith("virtual-"));

      if (updates.length > 0) {
        const res = await fetch("/api/objects/reorder", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bucketId, items: updates }),
        });
        if (!res.ok) {
          console.error("Reorder failed");
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCut = (obj: ObjectData) => {
    if (selectedIds.has(obj.id)) {
      // Cut all selected
      const items = [...viewObjects.folders, ...viewObjects.files].filter((i) =>
        selectedIds.has(i.id),
      );
      setClipboard({ action: "move", items });
    } else {
      setClipboard({ action: "move", items: [obj] });
    }
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
      const res = await fetch(`/api/objects/${taggingObj.id}`, {
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
      const res = await fetch(`/api/objects/${taggingObj.id}`, {
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

  // Global context imports
  const { addTasks, tasks } = useUpload();
  const { privateKey, setModalOpen } = useCrypto();
  const { startDownload } = useDownload();

  const [shareFile, setShareFile] = useState<ShareableFile | null>(null);

  async function getDEKBytes(fileId: string): Promise<Uint8Array> {
    if (!privateKey) {
      setModalOpen(true);
      throw new Error("Vault locked");
    }
    const res = await fetch(`/api/objects/${fileId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to get file metadata");
    if (!data.encryptedDEK)
      throw new Error("No encrypted key found for this file");
    const wrappedDEK = Uint8Array.from(atob(data.encryptedDEK), (c) =>
      c.charCodeAt(0),
    );
    const dekBytes = await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      privateKey,
      wrappedDEK,
    );
    return new Uint8Array(dekBytes);
  }

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

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if input/textarea is focused
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Delete
      if (e.key === "Delete" || e.key === "Backspace") {
        if (
          selectedIds.size > 0 &&
          !isCreateFolderOpen &&
          deleteIds.length === 0
        ) {
          e.preventDefault();
          setDeleteIds(Array.from(selectedIds));
        }
      }

      // Ctrl+A / Cmd+A (Select All)
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        const allIds = new Set([
          ...viewObjects.folders.map((f) => f.id),
          ...viewObjects.files.map((f) => f.id),
        ]);
        setSelectedIds(allIds);
      }

      // Escape (Clear Selection)
      if (e.key === "Escape") {
        e.preventDefault();
        setClipboard(null);
        setSelectedIds(new Set());
        setDownloadingId(null);
        closePreview();
        setTaggingObj(null);
        setIsCreateFolderOpen(false);
        setDeleteIds([]);
      }

      // Ctrl+X / Cmd+X (Cut)
      if ((e.ctrlKey || e.metaKey) && e.key === "x") {
        e.preventDefault();
        if (selectedIds.size > 0) {
          const items = [...viewObjects.folders, ...viewObjects.files].filter(
            (i) => selectedIds.has(i.id),
          );
          setClipboard({ action: "move", items });
          // Optional: Add some visual feedback or toast
        }
      }

      // Ctrl+C / Cmd+C (Copy - placeholder if we implement copy later, currently move only)
      // For now, let's just leave it or strictly implement what file explorer does?
      // User only asked specifically for ctrl+x.

      // Ctrl+V / Cmd+V (Paste)
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        e.preventDefault();
        if (clipboard) {
          handlePaste();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedIds,
    viewObjects,
    isCreateFolderOpen,
    deleteIds,
    clipboard,
    handlePaste,
  ]);

  // Resume download event — fired by the Resume button in DownloadProgress
  useEffect(() => {
    const handler = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      const obj = objects.find((o) => o.id === id);
      if (obj) {
        handleDownload(obj);
      }
    };
    window.addEventListener("xenode:resumeDownload", handler);
    return () => window.removeEventListener("xenode:resumeDownload", handler);
  }, [objects, privateKey]);

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
    if (deleteIds.length === 0) return;
    setDeleting(true);
    setError("");

    try {
      // Parallelize deletions
      await Promise.all(
        deleteIds.map(async (id) => {
          // Check if it's a folder (virtual or real)
          const isVirtual = id.startsWith("virtual-");
          // Find the object to get its key/prefix
          const folderObj = viewObjects.folders.find((f) => f.id === id);

          if (isVirtual || folderObj) {
            // It's a folder. We need to delete by prefix.
            // For virtual folders, the ID is virtual-[name], we need the key.
            // folderObj should exist in viewObjects if it's selected from there.
            const prefix = folderObj?.key;

            if (prefix) {
              const res = await fetch("/api/objects/folder", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bucketId, prefix }),
              });
              if (!res.ok) throw new Error("Failed to delete folder");
            }
          } else {
            // It's a file (or we couldn't find the folder obj)
            const res = await fetch(`/api/objects/${id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Failed to delete item");
          }
        }),
      );

      setDeleteIds([]);
      fetchData();
      // If deleted items were selected, clear selection
      const newSelected = new Set(selectedIds);
      deleteIds.forEach((id) => newSelected.delete(id));
      setSelectedIds(newSelected);
    } catch (err) {
      console.error(err);
      setError("Failed to delete object(s)");
    } finally {
      setDeleting(false);
    }
  };

  const handleDownload = async (obj: ObjectData) => {
    try {
      await startDownload(obj, !!obj.isEncrypted, privateKey);
    } catch (err: any) {
      if (err.message.includes("Vault locked")) {
        setModalOpen(true);
      }
      setError(err?.message || "Download failed");
    }
  };

  const navigateToFolder = (folderName: string) => {
    handleNavigation(`${currentPrefix}${folderName}/`);
  };

  const navigateUp = () => {
    if (currentPrefix === rootPrefix) return;
    const parts = currentPrefix.split("/").filter(Boolean);
    parts.pop();
    const newPath = parts.length > 0 ? `${parts.join("/")}/` : "";
    // Ensure we don't go below rootPrefix
    if (newPath.length < rootPrefix.length) {
      handleNavigation(rootPrefix);
    } else {
      handleNavigation(newPath);
    }
  };

  const navigateToBreadcrumb = (index: number) => {
    // breadcrumbs derived relative to rootPrefix
    const relativePrefix = currentPrefix.slice(rootPrefix.length);
    const parts = relativePrefix.split("/").filter(Boolean);
    const newRelativePath = parts.slice(0, index + 1).join("/");
    handleNavigation(`${rootPrefix}${newRelativePath}/`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
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
        <p className="text-muted-foreground/50 mb-4">
          {error || "Drive inaccessible"}
        </p>
        <Button
          onClick={() => window.location.reload()}
          variant="ghost"
          className="text-primary hover:bg-primary/10"
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

  const folderIds = viewObjects.folders.map((f) => f.id);
  const fileIds = viewObjects.files.map((f) => f.id);

  return (
    <div
      className="space-y-6 relative h-full min-h-[calc(100vh-100px)] outline-none select-none"
      {...getRootProps()}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleBackgroundClick}
    >
      <input {...getInputProps()} />

      {/* Drop Zone Overlay */}
      {isDragActive && (
        <div className="absolute inset-0 z-50 bg-background/90 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-primary rounded-xl transition-all duration-200">
          <div className="flex flex-col items-center gap-4">
            <div className="p-6 bg-primary/10 rounded-full animate-bounce">
              <Upload className="w-12 h-12 text-primary" />
            </div>
            <p className="text-2xl font-medium text-foreground">
              Drop files to upload
            </p>
            <p className="text-muted-foreground/50">
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
              onClick={() => handleNavigation(rootPrefix)}
              className={`flex items-center hover:text-primary transition-colors shrink-0 ${
                currentPrefix === rootPrefix
                  ? "text-foreground"
                  : "text-muted-foreground/60"
              }`}
            >
              <Home className="w-4 h-4" />
            </button>
            {breadcrumbs.map((part, i) => (
              <div key={i} className="flex items-center gap-2 shrink-0">
                <ChevronRight className="w-4 h-4 text-muted-foreground/30" />
                <button
                  onClick={() => navigateToBreadcrumb(i)}
                  className={`hover:text-primary transition-colors whitespace-nowrap ${
                    i === breadcrumbs.length - 1
                      ? "text-foreground font-medium"
                      : "text-muted-foreground/60"
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
          <div className="flex items-center bg-secondary/50 rounded-lg p-1 mr-2 border border-border">
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 w-7 p-0 ${
                viewMode === "list"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground/40 hover:text-foreground"
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
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground/40 hover:text-foreground"
              }`}
              onClick={() => toggleViewMode("grid")}
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
          </div>

          {/* Selection Indicator */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 mr-2 animate-in fade-in slide-in-from-right-4 duration-200 bg-primary/10 px-2 py-1 rounded-lg border border-primary/20">
              <span className="text-sm font-medium text-primary ml-1">
                {selectedIds.size} selected
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedIds(new Set())}
                className="h-6 w-6 text-primary/60 hover:text-primary hover:bg-primary/20 rounded-md"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          )}

          {/* Paste Button */}
          {clipboard && (
            <Button
              onClick={handlePaste}
              disabled={processingPaste}
              className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
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
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80 shrink-0"
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
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-medium shrink-0"
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
      <div className="bg-card/50 border border-border rounded-xl overflow-hidden min-h-[500px]">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {viewObjects.folders.length === 0 &&
          viewObjects.files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-4 h-full">
              <FileText className="w-12 h-12 text-muted-foreground/10 mb-4" />
              <p className="text-muted-foreground/40 text-sm mb-4">
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
                  <TableHead className="text-muted-foreground/50 w-[50%]">
                    Name
                  </TableHead>
                  <TableHead className="text-muted-foreground/50">
                    Size
                  </TableHead>
                  <TableHead className="text-muted-foreground/50">
                    Type
                  </TableHead>
                  <TableHead className="text-muted-foreground/50">
                    Last Modified
                  </TableHead>
                  <TableHead className="text-muted-foreground/50 text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentPrefix && currentPrefix !== rootPrefix && (
                  <TableRow
                    className="border-border hover:bg-secondary/50 cursor-pointer"
                    onClick={navigateUp}
                  >
                    <TableCell colSpan={5}>
                      <div className="flex items-center gap-2 text-muted-foreground/70">
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
                      key={folder.id}
                      item={folder}
                      viewMode="list"
                      currentPrefix={currentPrefix}
                      onNavigate={navigateToFolder}
                      onTag={() => setTaggingObj(folder)}
                      onCut={handleCut}
                      onShare={setShareFile}
                      onDelete={(item) => {
                        if (selectedIds.has(item.id)) {
                          setDeleteIds(Array.from(selectedIds));
                        } else {
                          setDeleteIds([item.id]);
                        }
                      }}
                      isSelected={selectedIds.has(folder.id)}
                      onSelect={handleSelect}
                      registerItemRef={(id, el) => {
                        if (!el) itemRefs.current.delete(id);
                        else itemRefs.current.set(id, el);
                      }}
                    />
                  ))}
                </SortableContext>

                <SortableContext
                  items={fileIds}
                  strategy={verticalListSortingStrategy}
                >
                  {viewObjects.files.map((file) => (
                    <FileItem
                      key={file.id}
                      item={file}
                      viewMode="list"
                      currentPrefix={currentPrefix}
                      onPreview={openPreview}
                      onDownload={handleDownload}
                      onCut={handleCut}
                      onShare={setShareFile}
                      onDelete={(item) => {
                        if (selectedIds.has(item.id)) {
                          setDeleteIds(Array.from(selectedIds));
                        } else {
                          setDeleteIds([item.id]);
                        }
                      }}
                      isDownloading={downloadingId === file.id}
                      isSelected={selectedIds.has(file.id)}
                      onSelect={handleSelect}
                      registerItemRef={(id, el) => {
                        if (!el) itemRefs.current.delete(id);
                        else itemRefs.current.set(id, el);
                      }}
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
                    key={folder.id}
                    item={folder}
                    viewMode="grid"
                    currentPrefix={currentPrefix}
                    onNavigate={navigateToFolder}
                    onTag={() => setTaggingObj(folder)}
                    onCut={handleCut}
                    onShare={setShareFile}
                    onDelete={(item) => {
                      if (selectedIds.has(item.id)) {
                        setDeleteIds(Array.from(selectedIds));
                      } else {
                        setDeleteIds([item.id]);
                      }
                    }}
                    isSelected={selectedIds.has(folder.id)}
                    onSelect={handleSelect}
                    registerItemRef={(id, el) => {
                      if (!el) itemRefs.current.delete(id);
                      else itemRefs.current.set(id, el);
                    }}
                  />
                ))}
              </SortableContext>

              <SortableContext items={fileIds} strategy={rectSortingStrategy}>
                {viewObjects.files.map((file) => (
                  <FileItem
                    key={file.id}
                    item={file}
                    viewMode="grid"
                    currentPrefix={currentPrefix}
                    onPreview={openPreview}
                    onDownload={handleDownload}
                    onCut={handleCut}
                    onShare={setShareFile}
                    onDelete={(item) => {
                      if (selectedIds.has(item.id)) {
                        setDeleteIds(Array.from(selectedIds));
                      } else {
                        setDeleteIds([item.id]);
                      }
                    }}
                    isDownloading={downloadingId === file.id}
                    isSelected={selectedIds.has(file.id)}
                    onSelect={handleSelect}
                    registerItemRef={(id, el) => {
                      if (!el) itemRefs.current.delete(id);
                      else itemRefs.current.set(id, el);
                    }}
                  />
                ))}
              </SortableContext>
            </div>
          )}
          <DragOverlay>
            {activeId
              ? (() => {
                  const item =
                    viewObjects.folders.find((f) => f.id === activeId) ||
                    viewObjects.files.find((f) => f.id === activeId);
                  if (!item) return null;
                  if (viewMode === "list")
                    return (
                      <div className="relative">
                        <FileRow
                          item={item}
                          viewMode="list"
                          currentPrefix={currentPrefix}
                          isOverlay={true}
                        />
                        {selectedIds.size > 1 && (
                          <Badge className="absolute -top-2 -right-2 bg-primary text-primary-foreground border-border z-50">
                            {selectedIds.size}
                          </Badge>
                        )}
                      </div>
                    );
                  return (
                    <div className="relative">
                      <FileCard
                        item={item}
                        viewMode="grid"
                        currentPrefix={currentPrefix}
                        isOverlay={true}
                      />
                      {selectedIds.size > 1 && (
                        <Badge className="absolute -top-2 -right-2 bg-primary text-primary-foreground border-border z-50">
                          {selectedIds.size}
                        </Badge>
                      )}
                    </div>
                  );
                })()
              : null}
          </DragOverlay>
        </DndContext>
      </div>

      <Dialog
        open={!!taggingObj}
        onOpenChange={(open) => !open && setTaggingObj(null)}
      >
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle>Manage Tags</DialogTitle>
            <DialogDescription className="text-muted-foreground/50">
              Add or remove tags for this item.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2 mb-4">
            <Input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Add a tag..."
              className="bg-secondary/50 border-border focus:border-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
            />
            <Button
              onClick={handleAddTag}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Add
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 min-h-[50px] bg-secondary/20 rounded-lg p-3">
            {taggingObj?.tags && taggingObj.tags.length > 0 ? (
              taggingObj.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="bg-secondary text-primary hover:bg-secondary flex gap-1 items-center pl-2 pr-1 py-1"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-destructive p-0.5 rounded-full hover:bg-background/20"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground/30 text-sm italic">
                No tags yet
              </span>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Folder Dialog */}
      <Dialog open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription className="text-muted-foreground/50">
              Enter a name for the new folder.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              className="bg-secondary/50 border-border text-foreground placeholder:text-muted-foreground/20"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setIsCreateFolderOpen(false)}
              className="text-muted-foreground/60 hover:text-foreground hover:bg-secondary/10"
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
        open={deleteIds.length > 0}
        onOpenChange={(open) => !open && setDeleteIds([])}
      >
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle>
              Delete {deleteIds.length > 1 ? "Objects" : "Object"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground/50">
              This will permanently delete{" "}
              {deleteIds.length > 1
                ? `these ${deleteIds.length} objects`
                : "this object"}
              . This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteIds([])}
              className="text-muted-foreground/60 hover:text-foreground hover:bg-secondary/10"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {deleting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Delete {deleteIds.length > 1 ? "Objects" : "Object"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Selection Box */}
      {selectionBox && (
        <div
          className="fixed border border-primary bg-primary/10 z-50 pointer-events-none"
          style={{
            left: Math.min(selectionBox.startX, selectionBox.currentX),
            top: Math.min(selectionBox.startY, selectionBox.currentY),
            width: Math.abs(selectionBox.currentX - selectionBox.startX),
            height: Math.abs(selectionBox.currentY - selectionBox.startY),
          }}
        />
      )}

      <ShareDialog
        open={!!shareFile}
        onOpenChange={(o) => !o && setShareFile(null)}
        file={shareFile}
        getDEKBytes={getDEKBytes}
      />
    </div>
  );
}

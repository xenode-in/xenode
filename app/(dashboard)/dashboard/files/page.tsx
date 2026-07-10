"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft,
  Upload,
  Trash2,
  FileText,
  Loader2,
  FolderPlus,
  Home,
  ChevronRight,
  LayoutGrid,
  List as ListIcon,
  Tag,
  Scissors,
  ClipboardPaste,
  Search,
  X,
  ChevronDown,
  SortAsc,
  SortDesc,
  RefreshCw,
  AlertTriangle,
  FolderOpen,
  Filter,
} from "lucide-react";
import { ShareDialog, ShareableFile } from "@/components/share-dialog";
import { useUpload } from "@/contexts/UploadContext";
import { useCrypto } from "@/contexts/CryptoContext";
import { useDownload } from "@/contexts/DownloadContext";
import { usePreview } from "@/contexts/PreviewContext";
import { useDropzone } from "react-dropzone";
import { FileItem } from "@/components/dashboard/FileItem";
import { SkeletonRow } from "@/components/dashboard/SkeletonRow";
import { SkeletonCard } from "@/components/dashboard/SkeletonCard";
import { formatBytes, formatDate } from "@/lib/utils";
import { useSession } from "@/lib/auth/client";
import { useFileSync, type FileSyncError } from "@/hooks/useFileSync";
import { useCryptoWorker } from "@/hooks/useCryptoWorker";
import { getDb } from "@/lib/db/local";
import {
  deleteLocalObjects,
  deleteLocalPrefix,
  upsertLocalObject,
  upsertLocalObjects,
} from "@/lib/db/object-cache";
import { useLiveQuery } from "dexie-react-hooks";
import {
  encryptMetadataString,
  decryptMetadataString,
} from "@/lib/crypto/fileEncryption";
import { cn } from "@/lib/utils";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
  SortingState,
  type Row,
  type RowSelectionState,
  type Updater,
} from "@tanstack/react-table";
import { useWindowVirtualizer } from "@tanstack/react-virtual";

interface ObjectData {
  id: string;
  key: string;
  size: number;
  contentType: string;
  createdAt: string;
  tags?: string[];
  position?: number;
  thumbnail?: string;
  isEncrypted?: boolean;
  encryptedName?: string;
  encryptedDisplayName?: string;
  encryptedContentType?: string;
  mediaCategory?: string;
  uploadSource?: "web" | "mobile_manual" | "mobile_backup" | "migration";
  syncContentFp?: string;
}

interface BucketData {
  _id: string;
  name: string;
  objectCount: number;
  totalSizeBytes: number;
  region: string;
  createdAt: string;
}

type SortField = "name" | "size" | "type" | "date";
type SortDir = "asc" | "desc";
type FilterType =
  | "all"
  | "folders"
  | "images"
  | "videos"
  | "documents"
  | "archives"
  | "audio";

const FILTER_OPTIONS: { value: FilterType; label: string }[] = [
  { value: "all", label: "All files" },
  { value: "folders", label: "Folders" },
  { value: "images", label: "Images" },
  { value: "videos", label: "Videos" },
  { value: "documents", label: "Documents" },
  { value: "archives", label: "Archives" },
  { value: "audio", label: "Audio" },
];

function normalizeFilter(value: string | null): FilterType {
  if (!value) return "all";
  if (value === "folder" || value === "folders") return "folders";
  if (value === "image" || value === "images") return "images";
  if (value === "video" || value === "videos") return "videos";
  if (value === "audio") return "audio";
  if (value === "archive" || value === "archives") return "archives";
  if (
    [
      "document",
      "documents",
      "pdf",
      "word",
      "excel",
      "powerpoint",
      "code",
    ].includes(value)
  ) {
    return "documents";
  }
  return "all";
}

function matchesFilter(obj: ObjectData, filter: string): boolean {
  if (filter === "all") return true;
  const normalizedFilter = normalizeFilter(filter);
  if (normalizedFilter === "folders") {
    return obj.contentType === "application/x-directory";
  }
  if (obj.contentType === "application/x-directory") return false;

  const contentType = obj.contentType.toLowerCase();
  if (filter === "pdf") return contentType.includes("pdf");
  if (filter === "word") return contentType.includes("word");
  if (filter === "excel") {
    return contentType.includes("excel") || contentType.includes("spreadsheet");
  }
  if (filter === "powerpoint") {
    return (
      contentType.includes("powerpoint") ||
      contentType.includes("presentation")
    );
  }
  if (filter === "code") {
    return ["json", "javascript", "xml", "html", "css", "typescript"].some(
      (value) => contentType.includes(value),
    );
  }
  if (normalizedFilter === "images") return contentType.startsWith("image/");
  if (normalizedFilter === "videos") return contentType.startsWith("video/");
  if (normalizedFilter === "audio") return contentType.startsWith("audio/");
  if (normalizedFilter === "archives") {
    return ["zip", "tar", "rar", "7z", "gzip"].some((value) =>
      contentType.includes(value),
    );
  }
  return [
    "pdf",
    "word",
    "document",
    "text/",
    "rtf",
    "spreadsheet",
    "excel",
    "presentation",
    "powerpoint",
    "json",
    "javascript",
    "xml",
  ].some((value) => contentType.includes(value));
}

function isMobileBackupImage(obj: ObjectData): boolean {
  const isImage =
    obj.mediaCategory === "image" || obj.contentType.startsWith("image/");
  return (
    isImage &&
    (obj.uploadSource === "mobile_backup" || Boolean(obj.syncContentFp))
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function Toolbar({
  selectedIds,
  allIds,
  onSelectAll,
  onClearSelection,
  onDelete,
  onCut,
  onPaste,
  clipboard,
  processingPaste,
  onUpload,
  onNewFolder,
  onSearch,
  searchTerm,
  viewMode,
  onViewMode,
  sortField,
  sortDir,
  onSort,
  filterType,
  onFilter,
}: {
  selectedIds: Set<string>;
  allIds: string[];
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDelete: () => void;
  onCut: () => void;
  onPaste: () => void;
  clipboard: { action: "move"; items: ObjectData[] } | null;
  processingPaste: boolean;
  onUpload: () => void;
  onNewFolder: () => void;
  onSearch: (val: string) => void;
  searchTerm: string;
  viewMode: "list" | "grid";
  onViewMode: (m: "list" | "grid") => void;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  filterType: FilterType;
  onFilter: (filter: FilterType) => void;
}) {
  const hasSelection = selectedIds.size > 0;
  const isAllSelected = allIds.length > 0 && selectedIds.size === allIds.length;
  const isPartialSelected =
    selectedIds.size > 0 && selectedIds.size < allIds.length;

  return (
    <div
      data-no-deselect
      className="flex items-center gap-2 px-4 py-2 shrink-0 min-h-[52px]"
    >
      <Checkbox
        checked={
          isAllSelected ? true : isPartialSelected ? "indeterminate" : false
        }
        onCheckedChange={(v) => (v ? onSelectAll() : onClearSelection())}
        aria-label="Select all"
        className="border-muted-foreground/30 data-[state=checked]:bg-primary data-[state=indeterminate]:bg-primary/60 shrink-0"
      />

      {hasSelection ? (
        <div className="flex items-center gap-1 animate-in fade-in slide-in-from-left-2 duration-150 shrink-0">
          <span className="text-sm font-medium text-foreground/60 mr-1 whitespace-nowrap">
            {selectedIds.size} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCut}
            className="h-8 gap-1.5 text-foreground/60 hover:text-foreground hover:bg-secondary/60 px-2 sm:px-3"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Cut</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="h-8 gap-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2 sm:px-3"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Delete</span>
          </Button>
          <div className="w-px h-5 bg-border mx-1" />
          <Button
            variant="ghost"
            size="icon"
            onClick={onClearSelection}
            className="h-8 w-8 text-foreground/40 hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 animate-in fade-in duration-150 shrink-0">
          {clipboard && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onPaste}
              disabled={processingPaste}
              className="h-8 gap-1.5 text-primary hover:bg-primary/10"
            >
              {processingPaste ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ClipboardPaste className="w-3.5 h-3.5" />
              )}
              Paste {clipboard.items.length} item
              {clipboard.items.length !== 1 ? "s" : ""}
            </Button>
          )}
        </div>
      )}

      <div className="flex-1" />

      {/* Standard buttons: Sort, View, New folder, Upload. Hide on mobile/tablet when there is active selection */}
      <div className={cn("items-center gap-2", hasSelection ? "hidden sm:flex" : "flex")}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 gap-1.5 hover:bg-secondary/60",
                filterType === "all"
                  ? "text-muted-foreground/60 hover:text-foreground"
                  : "text-primary",
              )}
            >
              <Filter className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {FILTER_OPTIONS.find((option) => option.value === filterType)
                  ?.label || "Filter"}
              </span>
              <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {FILTER_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => onFilter(option.value)}
                className={cn(
                  filterType === option.value && "text-primary font-medium",
                )}
              >
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sort dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-muted-foreground/60 hover:text-foreground hover:bg-secondary/60"
            >
              {sortDir === "asc" ? (
                <SortAsc className="w-3.5 h-3.5" />
              ) : (
                <SortDesc className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">Sort</span>
              <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {(["name", "size", "type", "date"] as SortField[]).map((f) => (
              <DropdownMenuItem
                key={f}
                onClick={() => onSort(f)}
                className={cn(
                  "capitalize gap-2",
                  sortField === f && "text-primary font-medium",
                )}
              >
                {sortField === f &&
                  (sortDir === "asc" ? (
                    <SortAsc className="w-3.5 h-3.5" />
                  ) : (
                    <SortDesc className="w-3.5 h-3.5" />
                  ))}
                {f === "date" ? "Modified" : f}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* View toggle */}
        <div className="flex items-center bg-secondary/40 rounded-md border border-border p-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onViewMode("list")}
            className={cn(
              "h-7 w-7 rounded-sm",
              viewMode === "list"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground/40 hover:text-foreground",
            )}
          >
            <ListIcon className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onViewMode("grid")}
            className={cn(
              "h-7 w-7 rounded-sm",
              viewMode === "grid"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground/40 hover:text-foreground",
            )}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="w-px h-5 bg-border" />

        <Button
          variant="ghost"
          size="sm"
          onClick={onNewFolder}
          className="h-8 gap-1.5 text-foreground/60 hover:text-foreground hover:bg-secondary/60"
        >
          <FolderPlus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">New folder</span>
        </Button>

        <Button
          size="sm"
          onClick={onUpload}
          className="h-8 gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
        >
          <Upload className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Upload</span>
        </Button>
      </div>
    </div>
  );
}

// ─── Breadcrumbs ──────────────────────────────────────────────────────────────

function Breadcrumbs({
  breadcrumbs,
  onNavigateHome,
  onNavigateTo,
}: {
  breadcrumbs: { part: string; display: string }[];
  onNavigateHome: () => void;
  onNavigateTo: (i: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 px-4 h-10 border-b border-border text-sm shrink-0 overflow-x-auto scrollbar-hide">
      <button
        onClick={onNavigateHome}
        className="flex items-center gap-1.5 text-muted-foreground/50 hover:text-foreground transition-colors shrink-0 px-1.5 py-1 rounded hover:bg-secondary/40"
      >
        <Home className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">My Drive</span>
      </button>
      {breadcrumbs.map((bc, i) => (
        <span key={i} className="flex items-center gap-1 shrink-0">
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/20" />
          <button
            onClick={() => onNavigateTo(i)}
            className={cn(
              "px-1.5 py-1 rounded hover:bg-secondary/40 transition-colors whitespace-nowrap",
              i === breadcrumbs.length - 1
                ? "text-foreground font-medium"
                : "text-muted-foreground/50 hover:text-foreground",
            )}
          >
            {bc.display}
          </button>
        </span>
      ))}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({
  onUpload,
  isFiltered,
  onClearFilter,
}: {
  onUpload: () => void;
  isFiltered: boolean;
  onClearFilter: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-secondary/40 border border-border flex items-center justify-center mb-4">
        <FolderOpen className="w-7 h-7 text-muted-foreground/30" />
      </div>
      <p className="text-sm font-medium text-foreground/60 mb-1">
        {isFiltered ? "No matching files" : "This folder is empty"}
      </p>
      <p className="text-xs text-muted-foreground/30 mb-5">
        {isFiltered
          ? "Try another file type or clear the current filter"
          : "Upload files or create a new folder to get started"}
      </p>
      <Button
        size="sm"
        onClick={isFiltered ? onClearFilter : onUpload}
        className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground h-8"
      >
        {isFiltered ? (
          <>
            <X className="w-3.5 h-3.5" /> Clear filter
          </>
        ) : (
          <>
            <Upload className="w-3.5 h-3.5" /> Upload files
          </>
        )}
      </Button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FilesPage() {
  useCryptoWorker(); // Bootstrap the background decryptor

  const router = useRouter();
  const searchParams = useSearchParams();
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map());
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectionBoxRef = useRef<HTMLDivElement>(null);

  const [isSelecting, setIsSelecting] = useState(false);

  const [bucketId, setBucketId] = useState<string | null>(null);
  const [bucket, setBucket] = useState<BucketData | null>(null);
  const [rootPrefix, setRootPrefix] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [currentPrefix, setCurrentPrefix] = useState("");
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [taggingObj, setTaggingObj] = useState<ObjectData | null>(null);
  const [newTag, setNewTag] = useState("");
  const [clipboard, setClipboard] = useState<{
    action: "move";
    items: ObjectData[];
  } | null>(null);
  const [processingPaste, setProcessingPaste] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [sortField, setSortField] = useState<SortField>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("filesSortField");
      if (
        saved === "name" ||
        saved === "size" ||
        saved === "type" ||
        saved === "date"
      )
        return saved;
    }
    return "name";
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("filesSortDir");
      if (saved === "asc" || saved === "desc") return saved;
    }
    return "asc";
  });
  const [shareFile, setShareFile] = useState<ShareableFile | null>(null);
  const [decryptedFolderNameMap, setDecryptedFolderNameMap] = useState<
    Record<string, string>
  >({});
  const [decryptedFileNameMap, setDecryptedFileNameMap] = useState<
    Record<string, string>
  >({});

  const { addTasks, tasks } = useUpload();
  const { privateKey, metadataKey, setModalOpen } = useCrypto();
  const { startDownload } = useDownload();
  const { openPreview, closePreview } = usePreview();
  const { data: session, isPending: sessionPending } = useSession();
  const userId = session?.user?.id || null;

  const typeFilter = searchParams.get("type") || "all";

  const redirectToLogin = useCallback(() => {
    const next =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "/dashboard/files";
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [router]);

  useEffect(() => {
    if (!sessionPending && !userId) redirectToLogin();
  }, [redirectToLogin, sessionPending, userId]);

  const {
    refetch,
    isFetched: filesFetched,
    error: syncError,
  } = useFileSync({
    bucketId,
    userId,
    fetchAll: true,
    sortBy: sortField,
    sortDir: sortDir,
    excludeMobileBackup: true,
  });

  const localFiles = useLiveQuery(() => {
    if (!userId || !bucketId) return [];
    const db = getDb(userId);
    return db.files.where("bucketId").equals(bucketId).toArray();
  }, [userId, bucketId]);
  const localFilesReady = !userId || !bucketId || localFiles !== undefined;

  // Temporarily map Dexie models to the expected ObjectData array to minimize disruptions
  const objects = useMemo(() => {
    return (localFiles ?? [])
      .map((f) => ({
        ...f,
        _id: f.id,
        encryptedName: f.encryptedName ?? undefined,
        encryptedDisplayName: f.encryptedDisplayName ?? undefined,
        encryptedContentType: f.encryptedContentType ?? undefined,
      }))
      .filter((obj) => !isMobileBackupImage(obj)) as unknown as ObjectData[];
  }, [localFiles]);

  const [initialLoading, setInitialLoading] = useState(true);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchBucket = useCallback(async () => {
    if (!bucketId) return;
    try {
      const res = await fetch(`/api/buckets/${bucketId}`, {
        credentials: "include",
      });
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Bucket not found");
        return;
      }
      const data = await res.json();
      setBucket(data.bucket);
    } catch {
      setError("Failed to load bucket data");
    } finally {
      setInitialLoading(false);
    }
  }, [bucketId, redirectToLogin]);

  useEffect(() => {
    let cancelled = false;

    async function fetchConfig() {
      setLoading(true);
      try {
        const res = await fetch("/api/drive/config", {
          credentials: "include",
        });
        if (res.status === 401) {
          redirectToLogin();
          return;
        }
        if (!res.ok) throw new Error("drive config failed");
        const data = await res.json();
        if (cancelled) return;

        if (data.bucket) {
          setBucketId(data.bucket._id);
          if (data.rootPrefix) {
            const folderParam = searchParams.get("folder");
            setCurrentPrefix(
              folderParam ? data.rootPrefix + folderParam : data.rootPrefix,
            );
            setRootPrefix(data.rootPrefix);
          }
        } else {
          setError("Failed to initialize drive storage");
        }
      } catch {
        if (!cancelled) setError("Failed to connect to storage");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchConfig();
    return () => {
      cancelled = true;
    };
  }, [redirectToLogin, searchParams]);

  useEffect(() => {
    if (!metadataKey || !objects.length) return;
    const run = async () => {
      const newMap: Record<string, string> = {};
      for (const obj of objects) {
        if (
          obj.contentType === "application/x-directory" &&
          obj.isEncrypted &&
          obj.encryptedDisplayName &&
          !decryptedFolderNameMap[obj.key]
        ) {
          try {
            newMap[obj.key] = await decryptMetadataString(
              obj.encryptedDisplayName,
              metadataKey,
            );
          } catch {}
        }
      }
      if (Object.keys(newMap).length > 0)
        setDecryptedFolderNameMap((prev) => ({ ...prev, ...newMap }));
    };
    run();
  }, [objects, metadataKey]);

  // Decrypt file names for accurate client-side name sorting/searching
  useEffect(() => {
    if (!metadataKey || !objects.length) return;
    const run = async () => {
      const newMap: Record<string, string> = {};
      for (const obj of objects) {
        if (
          obj.contentType !== "application/x-directory" &&
          obj.isEncrypted &&
          obj.encryptedName &&
          !decryptedFileNameMap[obj.id]
        ) {
          try {
            newMap[obj.id] = await decryptMetadataString(
              obj.encryptedName,
              metadataKey,
            );
          } catch {}
        }
      }
      if (Object.keys(newMap).length > 0)
        setDecryptedFileNameMap((prev) => ({ ...prev, ...newMap }));
    };
    run();
  }, [objects, metadataKey]);

  useEffect(() => {
    if ((syncError as FileSyncError | null)?.status === 401) {
      redirectToLogin();
    }
  }, [redirectToLogin, syncError]);

  useEffect(() => {
    if (!rootPrefix) return;
    const folderParam = searchParams.get("folder");
    const expected = folderParam ? `${rootPrefix}${folderParam}` : rootPrefix;
    if (currentPrefix !== expected) setCurrentPrefix(expected);
  }, [searchParams, rootPrefix]);

  useEffect(() => {
    const saved = localStorage.getItem("filesViewMode");
    if (saved === "list" || saved === "grid") setViewMode(saved);
  }, []);

  useEffect(() => {
    fetchBucket();
  }, [fetchBucket]);

  const prevCompletedCountRef = useRef(0);
  const dragStartRects = useRef<Map<string, DOMRect>>(new Map());
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    if (!bucketId) return;
    const count = tasks.filter(
      (t) =>
        t.bucketId === bucketId &&
        t.prefix === currentPrefix &&
        t.status === "completed",
    ).length;
    if (count > prevCompletedCountRef.current) refetch();
    prevCompletedCountRef.current = count;
  }, [tasks, bucketId, currentPrefix, refetch]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      const obj = objects.find((o) => o.id === id);
      if (obj) handleDownload(obj);
    };
    window.addEventListener("xenode:resumeDownload", handler);
    return () => window.removeEventListener("xenode:resumeDownload", handler);
  }, [objects, privateKey]);

  // ── Derived view data ──────────────────────────────────────────────────────

  const viewObjects = useMemo(() => {
    const folderMap = new Map<string, ObjectData>();
    const files: ObjectData[] = [];

    objects.forEach((obj) => {
      if (typeFilter !== "all") {
        if (!matchesFilter(obj, typeFilter)) return;
        if (obj.contentType === "application/x-directory") {
          folderMap.set(obj.key, obj);
        } else {
          files.push(obj);
        }
        return;
      }

      if (!obj.key.startsWith(currentPrefix) || obj.key === currentPrefix)
        return;

      const relKey = obj.key.slice(currentPrefix.length);
      const parts = relKey.split("/").filter(Boolean);

      // ✅ REAL FOLDERS ONLY
      if (obj.contentType === "application/x-directory") {
        const folderKey = obj.key;

        if (!folderMap.has(folderKey)) {
          folderMap.set(folderKey, obj);
        }

        return;
      }

      // ✅ FILES ONLY (no fake folders)
      if (parts.length === 1) {
        files.push(obj);
      }
    });

    const applySort = <T extends ObjectData>(arr: T[]): T[] =>
      [...arr].sort((a, b) => {
        let cmp = 0;
        if (sortField === "name") {
          const nameA =
            a.contentType === "application/x-directory"
              ? decryptedFolderNameMap[a.key] ||
                a.key.split("/").filter(Boolean).pop() ||
                a.key
              : decryptedFileNameMap[a.id] ||
                a.key.split("/").filter(Boolean).pop() ||
                a.key;
          const nameB =
            b.contentType === "application/x-directory"
              ? decryptedFolderNameMap[b.key] ||
                b.key.split("/").filter(Boolean).pop() ||
                b.key
              : decryptedFileNameMap[b.id] ||
                b.key.split("/").filter(Boolean).pop() ||
                b.key;
          cmp = nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
        } else if (sortField === "size") cmp = a.size - b.size;
        else if (sortField === "type")
          cmp = a.contentType.localeCompare(b.contentType);
        else
          cmp =
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return sortDir === "asc" ? cmp : -cmp;
      });

    const applySearch = <T extends ObjectData>(arr: T[]): T[] => {
      if (!searchTerm) return arr;
      const q = searchTerm.toLowerCase();
      return arr.filter((o) => {
        const name =
          o.contentType === "application/x-directory"
            ? decryptedFolderNameMap[o.key] ||
              o.key.split("/").filter(Boolean).pop() ||
              o.key
            : decryptedFileNameMap[o.id] ||
              o.key.split("/").filter(Boolean).pop() ||
              o.key;
        return name.toLowerCase().includes(q);
      });
    };

    return {
      folders: applySearch(applySort(Array.from(folderMap.values()))),
      files: applySearch(applySort(files)),
    };
  }, [
    objects,
    currentPrefix,
    sortField,
    sortDir,
    searchTerm,
    decryptedFolderNameMap,
    decryptedFileNameMap,
    typeFilter,
  ]);

  const combinedData = useMemo(() => {
    return [...viewObjects.folders, ...viewObjects.files];
  }, [viewObjects]);

  const allIds = useMemo(() => combinedData.map((d) => d.id), [combinedData]);

  const getHeaderClassName = (id: string) => {
    switch (id) {
      case "select":
        return "w-10 pl-4 pr-0";
      case "name":
        return "w-[45%] min-w-0";
      case "size":
        return "w-[15%]";
      case "type":
        return "w-[15%]";
      case "date":
        return "w-[20%] hidden md:table-cell";
      case "actions":
        return "text-right w-[100px]";
      default:
        return "";
    }
  };

  const columns = useMemo<ColumnDef<ObjectData>[]>(
    () => [
      {
        id: "select",
        header: "",
      },
      {
        accessorKey: "name",
        header: "Name",
      },
      {
        accessorKey: "size",
        header: "Size",
      },
      {
        accessorKey: "type",
        header: "Type",
      },
      {
        accessorKey: "date",
        header: "Last Modified",
      },
      {
        id: "actions",
        header: "Actions",
      },
    ],
    [],
  );

  const [sorting, setSorting] = useState<SortingState>([
    { id: sortField, desc: sortDir === "desc" },
  ]);

  useEffect(() => {
    setSorting([{ id: sortField, desc: sortDir === "desc" }]);
  }, [sortField, sortDir]);

  const onSortingChange = useCallback(
    (updater: Updater<SortingState>) => {
      const nextState =
        typeof updater === "function" ? updater(sorting) : updater;
      setSorting(nextState);
      if (nextState.length > 0) {
        const field = nextState[0].id as SortField;
        const desc = nextState[0].desc;
        setSortField(field);
        setSortDir(desc ? "desc" : "asc");
        localStorage.setItem("filesSortField", field);
        localStorage.setItem("filesSortDir", desc ? "desc" : "asc");
      }
    },
    [sorting],
  );

  const rowSelection = useMemo<RowSelectionState>(() => {
    const selection: Record<string, boolean> = {};
    selectedIds.forEach((id) => {
      selection[id] = true;
    });
    return selection;
  }, [selectedIds]);

  const handleRowSelectionChange = useCallback(
    (updater: Updater<RowSelectionState>) => {
      const nextSelection =
        typeof updater === "function" ? updater(rowSelection) : updater;
      const nextSelectedIds = new Set<string>();
      Object.keys(nextSelection).forEach((id) => {
        if (nextSelection[id]) nextSelectedIds.add(id);
      });
      setSelectedIds(nextSelectedIds);
    },
    [rowSelection],
  );

  const table = useReactTable({
    data: combinedData,
    columns,
    state: {
      sorting,
      rowSelection,
    },
    onSortingChange,
    onRowSelectionChange: handleRowSelectionChange,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    enableRowSelection: true,
    getRowId: (row) => row.id,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const hasBackRow = currentPrefix && currentPrefix !== rootPrefix;

  const [scrollMargin, setScrollMargin] = useState(0);

  useEffect(() => {
    const updateMargin = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        // table body elements start after table header (40px) and optional BackRow (53px)
        const headerHeight = 40;
        const backRowHeight = hasBackRow ? 53 : 0;
        setScrollMargin(
          rect.top + window.scrollY + headerHeight + backRowHeight,
        );
      }
    };
    updateMargin();
    const timer = setTimeout(updateMargin, 150);
    window.addEventListener("resize", updateMargin);
    window.addEventListener("scroll", updateMargin);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateMargin);
      window.removeEventListener("scroll", updateMargin);
    };
  }, [hasBackRow, currentPrefix]);

  const rowVirtualizer = useWindowVirtualizer({
    count: table.getRowModel().rows.length,
    estimateSize: () => 53,
    scrollMargin,
    overscan: 40,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const paddingTop =
    virtualRows.length > 0 ? virtualRows[0].start - scrollMargin : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - virtualRows[virtualRows.length - 1].end
      : 0;

  const [cols, setCols] = useState(5);

  useEffect(() => {
    const updateCols = () => {
      const w = window.innerWidth;
      if (w >= 1024) setCols(5);
      else if (w >= 768) setCols(4);
      else if (w >= 640) setCols(3);
      else setCols(2);
    };
    updateCols();
    window.addEventListener("resize", updateCols);
    return () => window.removeEventListener("resize", updateCols);
  }, []);

  const [gridScrollMargin, setGridScrollMargin] = useState(0);

  useEffect(() => {
    const updateMargin = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        // grid elements start at the top of the container + padding (16px / p-4)
        const gridPadding = 16;
        setGridScrollMargin(rect.top + window.scrollY + gridPadding);
      }
    };
    updateMargin();
    const timer = setTimeout(updateMargin, 150);
    window.addEventListener("resize", updateMargin);
    window.addEventListener("scroll", updateMargin);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateMargin);
      window.removeEventListener("scroll", updateMargin);
    };
  }, [currentPrefix]);

  const gridItems = useMemo<Array<Row<ObjectData> | { id: string; isBackCard: true }>>(() => {
    const rows = table.getRowModel().rows;
    if (hasBackRow) {
      return [{ id: "back-row-card", isBackCard: true }, ...rows];
    }
    return rows;
  }, [table.getRowModel().rows, hasBackRow]);

  const gridRows = useMemo(() => {
    const chunked = [];
    for (let i = 0; i < gridItems.length; i += cols) {
      chunked.push(gridItems.slice(i, i + cols));
    }
    return chunked;
  }, [gridItems, cols]);

  const gridVirtualizer = useWindowVirtualizer({
    count: gridRows.length,
    estimateSize: () => 220,
    scrollMargin: gridScrollMargin,
    overscan: 10,
  });

  // ── Scrolling state ────────────────────────────────────────────────────────────
  // Passed to FileItem so it can skip expensive thumbnail loading during scroll
  // while keeping the row structure mounted (prevents abort of in-flight requests).
  const listIsScrolling = rowVirtualizer.isScrolling;
  const gridIsScrolling = gridVirtualizer.isScrolling;

  // ── Selection ──────────────────────────────────────────────────────────────

  const handleSelect = useCallback(
    (item: ObjectData, e: React.MouseEvent) => {
      const id = item.id;
      e.stopPropagation();
      e.preventDefault();
      const newSelected = new Set(selectedIds);
      if (e.ctrlKey || e.metaKey) {
        newSelected.has(id) ? newSelected.delete(id) : newSelected.add(id);
        setLastSelectedId(id);
      } else if (e.shiftKey && lastSelectedId) {
        const all = [...viewObjects.folders, ...viewObjects.files];
        const li = all.findIndex((i) => i.id === lastSelectedId);
        const ci = all.findIndex((i) => i.id === id);
        if (li !== -1 && ci !== -1) {
          newSelected.clear();
          all
            .slice(Math.min(li, ci), Math.max(li, ci) + 1)
            .forEach((i) => newSelected.add(i.id));
        }
      } else {
        newSelected.clear();
        newSelected.add(id);
        setLastSelectedId(id);
      }
      setSelectedIds(newSelected);
    },
    [selectedIds, lastSelectedId, viewObjects],
  );

  const handleDeleteItem = useCallback(
    (item: ObjectData) => {
      if (selectedIds.has(item.id) && selectedIds.size > 1) {
        setDeleteIds(Array.from(selectedIds));
      } else {
        setDeleteIds([item.id]);
      }
    },
    [selectedIds],
  );

  const handlePreview = useCallback(
    (file: ObjectData) => {
      openPreview(file, viewObjects.files);
    },
    [openPreview, viewObjects.files],
  );

  const registerItemRef = useCallback((id: string, el: HTMLElement | null) => {
    if (!el) itemRefs.current.delete(id);
    else itemRefs.current.set(id, el);
  }, []);

  // ── Navigation ─────────────────────────────────────────────────────────────

  const handleNavigation = useCallback(
    (prefix: string) => {
      const relative = prefix.startsWith(rootPrefix)
        ? prefix.slice(rootPrefix.length)
        : prefix;
      router.push(`?folder=${encodeURIComponent(relative)}`);
      setCurrentPrefix(prefix);
      setSelectedIds(new Set());
    },
    [router, rootPrefix],
  );

  const navigateToFolder = useCallback(
    (folderName: string) => handleNavigation(`${currentPrefix}${folderName}/`),
    [handleNavigation, currentPrefix],
  );

  const navigateUp = () => {
    if (currentPrefix === rootPrefix) return;
    const parts = currentPrefix.split("/").filter(Boolean);
    parts.pop();
    const newPath = parts.length > 0 ? `${parts.join("/")}/` : "";
    handleNavigation(newPath.length < rootPrefix.length ? rootPrefix : newPath);
  };

  const navigateToBreadcrumb = (index: number) => {
    const parts = currentPrefix
      .slice(rootPrefix.length)
      .split("/")
      .filter(Boolean);
    handleNavigation(`${rootPrefix}${parts.slice(0, index + 1).join("/")}/`);
  };

  const breadcrumbs = useMemo(() => {
    const parts = currentPrefix
      .slice(rootPrefix.length)
      .split("/")
      .filter(Boolean);
    let running = rootPrefix;
    return parts.map((part) => {
      running += `${part}/`;
      return { part, display: decryptedFolderNameMap[running] || part };
    });
  }, [currentPrefix, rootPrefix, decryptedFolderNameMap]);

  // ── Sort ───────────────────────────────────────────────────────────────────

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      const newDir = sortDir === "asc" ? "desc" : "asc";
      setSortDir(newDir);
      localStorage.setItem("filesSortDir", newDir);
    } else {
      setSortField(field);
      setSortDir("asc");
      localStorage.setItem("filesSortField", field);
      localStorage.setItem("filesSortDir", "asc");
    }
  };

  const handleFilter = (filter: FilterType) => {
    const params = new URLSearchParams(searchParams.toString());
    if (filter === "all") params.delete("type");
    else params.set("type", filter);
    setSelectedIds(new Set());
    const query = params.toString();
    router.replace(query ? `/dashboard/files?${query}` : "/dashboard/files");
  };

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !bucketId) return;
    addTasks(Array.from(files), bucketId, currentPrefix);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setTimeout(refetch, 1000);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !bucketId) return;
    setCreatingFolder(true);
    setError("");
    try {
      const isEnc = !!privateKey;
      const folderName = newFolderName.trim();
      const storageName = isEnc ? crypto.randomUUID() : folderName;
      let encryptedDisplayName: string | undefined;
      if (isEnc && metadataKey)
        encryptedDisplayName = await encryptMetadataString(
          folderName,
          metadataKey,
        );
      const res = await fetch("/api/objects/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bucketId,
          name: storageName,
          encryptedDisplayName,
          prefix: currentPrefix,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await upsertLocalObject(userId, data.folder, bucketId);
        setNewFolderName("");
        setIsCreateFolderOpen(false);
        fetchBucket();
        refetch();
      } else {
        const d = await res.json();
        setError(d.error || "Failed to create folder");
      }
    } catch {
      setError("Failed to create folder");
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteIds.length) return;
    setDeleting(true);
    setError("");
    try {
      await Promise.all(
        deleteIds.map(async (id) => {
          const folderObj = viewObjects.folders.find((f) => f.id === id);
          if (id.startsWith("virtual-") || folderObj) {
            if (folderObj?.key) {
              const res = await fetch("/api/objects/folder", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bucketId, prefix: folderObj.key }),
              });
              if (!res.ok) throw new Error("Failed to delete folder");
              await deleteLocalPrefix(userId, bucketId, folderObj.key);
            }
          } else {
            const res = await fetch(`/api/objects/${id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Failed to delete item");
            await deleteLocalObjects(userId, [id]);
          }
        }),
      );
      setDeleteIds([]);
      fetchBucket();
      refetch();
      setSelectedIds((prev) => {
        const n = new Set(prev);
        deleteIds.forEach((id) => n.delete(id));
        return n;
      });
    } catch {
      setError("Failed to delete item(s)");
    } finally {
      setDeleting(false);
    }
  };

  const handleDownload = useCallback(
    async (obj: ObjectData) => {
      try {
        await startDownload(obj, !!obj.isEncrypted, privateKey);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Download failed";
        if (message.includes("Vault locked")) setModalOpen(true);
        setError(message);
      }
    },
    [startDownload, privateKey],
  );

  const handleCut = useCallback(() => {
    if (selectedIds.size === 0) return;

    const items = [...viewObjects.folders, ...viewObjects.files].filter((i) =>
      selectedIds.has(i.id),
    );

    setClipboard({ action: "move", items });
    setSelectedIds(new Set());
  }, [selectedIds, viewObjects]);

  const handlePaste = useCallback(async () => {
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
      if (res.ok) {
        const data = await res.json();
        await Promise.all(
          clipboard.items.map((item) =>
            item.contentType === "application/x-directory" ||
            item.key.endsWith("/")
              ? deleteLocalPrefix(userId, bucketId, item.key)
              : deleteLocalObjects(userId, [item.id]),
          ),
        );
        await upsertLocalObjects(userId, data.movedObjects, bucketId);
        setClipboard(null);
        setSelectedIds(new Set());
        fetchBucket();
        refetch();
      } else {
        const d = await res.json();
        setError(d.error || "Failed to move items");
      }
    } catch {
      setError("Failed to move items");
    } finally {
      setProcessingPaste(false);
    }
  }, [clipboard, bucketId, currentPrefix, refetch, fetchBucket, userId]);

  const handleAddTag = async () => {
    if (!taggingObj || !newTag.trim()) return;
    const cur = taggingObj.tags || [];
    if (cur.includes(newTag.trim())) {
      setNewTag("");
      return;
    }
    let tagToSave = newTag.trim();
    if (privateKey && metadataKey)
      tagToSave = await encryptMetadataString(tagToSave, metadataKey);
    try {
      const res = await fetch(`/api/objects/${taggingObj.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: [...cur, tagToSave] }),
      });
      if (res.ok) {
        await upsertLocalObject(
          userId,
          { ...taggingObj, tags: [...cur, tagToSave], updatedAt: new Date() },
          bucketId,
        );
        setTaggingObj({ ...taggingObj, tags: [...cur, tagToSave] });
        setNewTag("");
        fetchBucket();
        refetch();
      }
    } catch {}
  };

  const handleRemoveTag = async (tag: string) => {
    if (!taggingObj) return;
    const updated = (taggingObj.tags || []).filter((t) => t !== tag);
    try {
      const res = await fetch(`/api/objects/${taggingObj.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: updated }),
      });
      if (res.ok) {
        await upsertLocalObject(
          userId,
          { ...taggingObj, tags: updated, updatedAt: new Date() },
          bucketId,
        );
        setTaggingObj({ ...taggingObj, tags: updated });
        fetchBucket();
        refetch();
      }
    } catch {}
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;

    // ❗ DO NOT START SELECTION if clicking UI
    if (
      target.closest("button") ||
      target.closest("[role='button']") ||
      target.closest("[data-no-deselect]") ||
      target.closest("input") ||
      target.closest("svg")
    ) {
      return;
    }

    // ❗ DO NOT start selection if clicking on file item (let FileItem handle it)
    if (target.closest(".file-item-selectable")) return;

    selectionStartRef.current = { x: e.clientX, y: e.clientY };

    setIsSelecting(true);
    if (selectionBoxRef.current) {
      selectionBoxRef.current.style.left = `${e.clientX}px`;
      selectionBoxRef.current.style.top = `${e.clientY}px`;
      selectionBoxRef.current.style.width = "0px";
      selectionBoxRef.current.style.height = "0px";
      selectionBoxRef.current.classList.remove("hidden");
    }

    if (!e.ctrlKey && !e.metaKey) {
      setSelectedIds(new Set());
    }

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
      if (!isSelecting || !selectionStartRef.current) return;

      const clientX = e.clientX;
      const clientY = e.clientY;

      const { x: startX, y: startY } = selectionStartRef.current;

      // ✅ drag threshold (fix random selection bug)
      const dx = Math.abs(clientX - startX);
      const dy = Math.abs(clientY - startY);
      if (dx < 5 && dy < 5) return;

      if (rafId.current) cancelAnimationFrame(rafId.current);

      rafId.current = requestAnimationFrame(() => {
        if (selectionBoxRef.current) {
          const left = Math.min(startX, clientX);
          const top = Math.min(startY, clientY);
          const width = Math.abs(clientX - startX);
          const height = Math.abs(clientY - startY);

          selectionBoxRef.current.style.left = `${left}px`;
          selectionBoxRef.current.style.top = `${top}px`;
          selectionBoxRef.current.style.width = `${width}px`;
          selectionBoxRef.current.style.height = `${height}px`;
        }

        const boxRect = {
          left: Math.min(startX, clientX),
          right: Math.max(startX, clientX),
          top: Math.min(startY, clientY),
          bottom: Math.max(startY, clientY),
        };

        const nextSelected = new Set<string>();

        for (const [id, rect] of dragStartRects.current.entries()) {
          if (rectsIntersect(rect, boxRect)) {
            nextSelected.add(id);
          }
        }

        // ✅ ctrl / cmd additive selection (FIXED) + equality check to prevent needless rendering
        setSelectedIds((prev) => {
          const finalSelected =
            e.ctrlKey || e.metaKey
              ? new Set([...prev, ...nextSelected])
              : nextSelected;

          if (prev.size === finalSelected.size) {
            let equal = true;
            for (const item of finalSelected) {
              if (!prev.has(item)) {
                equal = false;
                break;
              }
            }
            if (equal) return prev;
          }
          return finalSelected;
        });
      });
    },
    [isSelecting],
  );

  const handleMouseUp = () => {
    if (isSelecting) {
      setIsSelecting(false);
      if (selectionBoxRef.current) {
        selectionBoxRef.current.classList.add("hidden");
      }

      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }

      dragStartRects.current.clear();
      selectionStartRef.current = null;
    }
  };

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

  // ── Dropzone ───────────────────────────────────────────────────────────────

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0 && bucketId) {
        addTasks(Array.from(acceptedFiles), bucketId, currentPrefix);
        setTimeout(refetch, 1000);
      }
    },
    [addTasks, bucketId, currentPrefix, refetch],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
  });

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      )
        return;
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedIds.size > 0 &&
        !isCreateFolderOpen &&
        !deleteIds.length
      ) {
        e.preventDefault();
        setDeleteIds(Array.from(selectedIds));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        setSelectedIds(new Set(allIds));
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setClipboard(null);
        setSelectedIds(new Set());
        closePreview();
        setTaggingObj(null);
        setIsCreateFolderOpen(false);
        setDeleteIds([]);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "x" && selectedIds.size > 0) {
        e.preventDefault();
        const items = [...viewObjects.folders, ...viewObjects.files].filter(
          (i) => selectedIds.has(i.id),
        );
        setClipboard({ action: "move", items });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "v" && clipboard) {
        e.preventDefault();
        handlePaste();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    selectedIds,
    allIds,
    isCreateFolderOpen,
    deleteIds,
    clipboard,
    viewObjects,
    closePreview,
    handlePaste,
  ]);

  // ── Loading / error states ─────────────────────────────────────────────────

  const waitingForInitialFiles = Boolean(
    bucketId &&
      userId &&
      (!localFilesReady || (!filesFetched && !syncError)),
  );

  if (sessionPending || loading || initialLoading || waitingForInitialFiles)
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      </div>
    );

  if (!bucket)
    return (
      <div
        className="flex flex-col h-full min-h-[calc(100vh-100px)] relative select-none outline-none"
        {...getRootProps()}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={(e) => {
          const target = e.target as HTMLElement;

          // ❗ DO NOT clear selection if clicking on buttons, toolbar, or UI
          if (
            target.closest("button") ||
            target.closest("[role='button']") ||
            target.closest(".file-item-selectable") ||
            target.closest("[data-no-deselect]")
          ) {
            return;
          }

          if (e.target === e.currentTarget) {
            setSelectedIds(new Set());
            setLastSelectedId(null);
          }
        }}
      >
        <AlertTriangle className="w-8 h-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground/50">
          {error || "Drive inaccessible"}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.location.reload()}
          className="gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </Button>
      </div>
    );

  const isEmpty =
    viewObjects.folders.length === 0 && viewObjects.files.length === 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-full min-h-[calc(100vh-100px)] relative select-none outline-none"
      {...getRootProps()}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={(e) => {
        const target = e.target as HTMLElement;

        // ❗ DO NOT clear selection if clicking on buttons, toolbar, or UI
        if (
          target.closest("button") ||
          target.closest("[role='button']") ||
          target.closest(".file-item-selectable") ||
          target.closest("[data-no-deselect]")
        ) {
          return;
        }

        if (e.target === e.currentTarget) {
          setSelectedIds(new Set());
          setLastSelectedId(null);
        }
      }}
    >
      <input {...getInputProps()} />
      {/* Drag-select rubber-band box */}
      <div
        ref={selectionBoxRef}
        className="fixed z-[60] pointer-events-none border border-primary/60 bg-primary/10 hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleUpload}
        className="hidden"
      />

      {/* Drop overlay */}
      {isDragActive && (
        <div className="absolute inset-0 z-50 bg-background/90 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-primary/50 rounded-xl transition-all duration-200">
          <div className="flex flex-col items-center gap-3">
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

      {/* Breadcrumbs */}
      <Breadcrumbs
        breadcrumbs={breadcrumbs}
        onNavigateHome={() => handleNavigation(rootPrefix)}
        onNavigateTo={navigateToBreadcrumb}
      />

      {/* Toolbar */}
      <Toolbar
        selectedIds={selectedIds}
        allIds={allIds}
        onSelectAll={() => setSelectedIds(new Set(allIds))}
        onClearSelection={() => setSelectedIds(new Set())}
        onDelete={() => setDeleteIds(Array.from(selectedIds))}
        onCut={handleCut}
        onPaste={handlePaste}
        clipboard={clipboard}
        processingPaste={processingPaste}
        onUpload={() => fileInputRef.current?.click()}
        onNewFolder={() => setIsCreateFolderOpen(true)}
        onSearch={setSearchTerm}
        searchTerm={searchTerm}
        viewMode={viewMode}
        onViewMode={(m) => {
          setViewMode(m);
          localStorage.setItem("filesViewMode", m);
        }}
        sortField={sortField}
        sortDir={sortDir}
        onSort={handleSort}
        filterType={normalizeFilter(typeFilter)}
        onFilter={handleFilter}
      />

      {/* Error banner */}
      {error && (
        <div className="mx-0 mt-0 flex items-center gap-2 text-xs text-red-400 bg-red-500/8 border-b border-red-500/15 px-4 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {error}
          <button
            onClick={() => setError("")}
            className="ml-auto text-red-400/60 hover:text-red-400"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Main content */}
      <div
        ref={containerRef}
        className="bg-card/50 border border-border rounded-xl min-h-[500px] mt-4 relative overflow-visible"
      >
        {isEmpty ? (
          <EmptyState
            onUpload={() => fileInputRef.current?.click()}
            isFiltered={typeFilter !== "all"}
            onClearFilter={() => handleFilter("all")}
          />
        ) : viewMode === "list" ? (
          <div className="w-full overflow-x-auto md:contents">
            <table className="w-full min-w-[750px] md:min-w-full caption-bottom text-sm">
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow
                    key={headerGroup.id}
                    className="border-border hover:bg-transparent"
                  >
                    {headerGroup.headers.map((header) => {
                      const headerId = header.id;
                      const headerStyle = getHeaderClassName(headerId);
                      const canSort = header.column.getCanSort();
                      return (
                        <TableHead
                          key={header.id}
                          onClick={
                            canSort
                              ? header.column.getToggleSortingHandler()
                              : undefined
                          }
                          className={cn(
                            "text-muted-foreground/50 select-none md:sticky md:top-[68px] bg-background/95 backdrop-blur-md z-30 border-b border-border shadow-[0_1px_0_0_rgba(255,255,255,0.05)]",
                            canSort && "cursor-pointer hover:text-foreground",
                            headerStyle,
                          )}
                        >
                          <span className="flex items-center gap-1">
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                            {canSort && (
                              <span className="inline-block ml-0.5">
                                {header.column.getIsSorted() === "asc" && (
                                  <SortAsc className="w-3 h-3 text-primary" />
                                )}
                                {header.column.getIsSorted() === "desc" && (
                                  <SortDesc className="w-3 h-3 text-primary" />
                                )}
                              </span>
                            )}
                          </span>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {/* Back row — colSpan=6 accounts for the checkbox column */}
                {currentPrefix && currentPrefix !== rootPrefix && (
                  <TableRow
                    className="border-border hover:bg-secondary/50 cursor-pointer h-[53px]"
                    onClick={navigateUp}
                  >
                    <TableCell colSpan={6} className="py-2 pl-4">
                      <div className="flex items-center gap-2 text-muted-foreground/70">
                        <ArrowLeft className="w-4 h-4" />
                        <span>..</span>
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {paddingTop > 0 && (
                  <TableRow
                    style={{ height: `${paddingTop}px` }}
                    className="hover:bg-transparent border-0 pointer-events-none"
                  >
                    <TableCell
                      colSpan={6}
                      style={{ height: `${paddingTop}px`, padding: 0 }}
                    />
                  </TableRow>
                )}

                {virtualRows.map((virtualRow) => {
                  const row = table.getRowModel().rows[virtualRow.index];
                  const item = row.original;
                  const isFolder =
                    item.contentType === "application/x-directory" ||
                    item.key.endsWith("/");

                  return (
                    <FileItem
                      key={item.id}
                      item={item}
                      viewMode="list"
                      currentPrefix={currentPrefix}
                      isScrolling={listIsScrolling}
                      onNavigate={isFolder ? navigateToFolder : undefined}
                      onPreview={!isFolder ? handlePreview : undefined}
                      onDownload={!isFolder ? handleDownload : undefined}
                      onTag={setTaggingObj}
                      onCut={handleCut}
                      onShare={setShareFile}
                      onDelete={handleDeleteItem}
                      isDownloading={
                        !isFolder && downloadingId === item.id
                          ? true
                          : undefined
                      }
                      isSelected={selectedIds.has(item.id)}
                      onSelect={handleSelect}
                      registerItemRef={registerItemRef}
                    />
                  );
                })}

                {paddingBottom > 0 && (
                  <TableRow
                    style={{ height: `${paddingBottom}px` }}
                    className="hover:bg-transparent border-0 pointer-events-none"
                  >
                    <TableCell
                      colSpan={6}
                      style={{ height: `${paddingBottom}px`, padding: 0 }}
                    />
                  </TableRow>
                )}
              </TableBody>
            </table>
          </div>
        ) : (
          /* Grid view */
          <div
            style={{
              height: `${gridVirtualizer.getTotalSize()}px`,
              position: "relative",
              width: "100%",
            }}
          >
            {gridVirtualizer.getVirtualItems().map((virtualRow) => {
              const rowItems = gridRows[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={gridVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start - gridScrollMargin}px)`,
                  }}
                  className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 px-4 py-2"
                >
                  {rowItems.map((rowOrBack) => {
                    if ("isBackCard" in rowOrBack) {
                      return (
                        <div
                          key="back-card"
                          onClick={navigateUp}
                          className="aspect-square bg-white/5 rounded-xl border border-white/5 flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 transition-all hover:scale-[1.02]"
                        >
                          <ArrowLeft className="w-8 h-8 text-[#e8e4d9]/50 mb-2" />
                          <span className="text-[#e8e4d9]/70 font-medium text-sm">
                            Back
                          </span>
                        </div>
                      );
                    }

                    const row = rowOrBack;
                    const item = row.original;
                    const isFolder =
                      item.contentType === "application/x-directory" ||
                      item.key.endsWith("/");

                    return (
                      <FileItem
                        key={item.id}
                        item={item}
                        viewMode="grid"
                        currentPrefix={currentPrefix}
                        isScrolling={gridIsScrolling}
                        onNavigate={isFolder ? navigateToFolder : undefined}
                        onPreview={!isFolder ? handlePreview : undefined}
                        onDownload={!isFolder ? handleDownload : undefined}
                        onTag={setTaggingObj}
                        onCut={handleCut}
                        onShare={setShareFile}
                        onDelete={handleDeleteItem}
                        isDownloading={
                          !isFolder && downloadingId === item.id
                            ? true
                            : undefined
                        }
                        isSelected={selectedIds.has(item.id)}
                        onSelect={handleSelect}
                        registerItemRef={registerItemRef}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Dialogs ── */}

      <Dialog
        open={!!taggingObj}
        onOpenChange={(o) => !o && setTaggingObj(null)}
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
            {taggingObj?.tags?.length ? (
              taggingObj.tags.map((tag) => (
                <TagItem
                  key={tag}
                  encryptedTag={tag}
                  metadataKey={metadataKey}
                  onRemove={handleRemoveTag}
                />
              ))
            ) : (
              <span className="text-muted-foreground/30 text-sm italic">
                No tags yet
              </span>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
              autoFocus
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

      <Dialog
        open={deleteIds.length > 0}
        onOpenChange={(o) => !o && setDeleteIds([])}
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

      <ShareDialog
        open={!!shareFile}
        onOpenChange={(o) => !o && setShareFile(null)}
        file={shareFile}
        getDEKBytes={getDEKBytes}
      />
    </div>
  );
}

// ─── Tag Item ─────────────────────────────────────────────────────────────────

function TagItem({
  encryptedTag,
  metadataKey,
  onRemove,
}: {
  encryptedTag: string;
  metadataKey: CryptoKey | null;
  onRemove: (tag: string) => void;
}) {
  const [display, setDisplay] = useState(encryptedTag);
  const shouldDecrypt =
    !!metadataKey &&
    (encryptedTag.startsWith("0x02") || encryptedTag.length > 50);

  useEffect(() => {
    if (shouldDecrypt) {
      decryptMetadataString(encryptedTag, metadataKey)
        .then(setDisplay)
        .catch(() => setDisplay(encryptedTag));
    }
  }, [encryptedTag, metadataKey, shouldDecrypt]);

  return (
    <Badge
      variant="secondary"
      className="bg-secondary text-primary hover:bg-secondary flex gap-1 items-center pl-2 pr-1 py-1"
    >
      {shouldDecrypt ? display : encryptedTag}
      <button
        onClick={() => onRemove(encryptedTag)}
        className="hover:text-destructive p-0.5 rounded-full hover:bg-background/20"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </Badge>
  );
}

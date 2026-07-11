import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { TableRow, TableCell } from "@/components/ui/table";
import {
  Folder,
  Trash2,
  Tag,
  Scissors,
  Lock,
  FileText,
  Link2,
  DownloadCloud,
  Info,
  Star,
} from "lucide-react";
import { formatBytes, formatDate, cn } from "@/lib/utils";
import { getFileIcon } from "@/lib/file-icons";
import { forwardRef, useRef, useCallback, useState, useEffect, memo } from "react";
import { useCrypto } from "@/contexts/CryptoContext";
import {
  decryptFileName,
  decryptMetadataString,
} from "@/lib/crypto/fileEncryption";
import { useThumbnail } from "@/hooks/useThumbnail";
import { useIsVisible } from "@/hooks/useIsVisible";
import { MetadataDialog } from "./MetadataDialog";
import { SkeletonRow } from "./SkeletonRow";
import { SkeletonCard } from "./SkeletonCard";
import { useWorkspaceSpaceKey } from "@/lib/orgs/useWorkspaceSpaceKey";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";

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
  mediaCategory?: string;
  encryptedName?: string;
  encryptedDisplayName?: string;
  encryptedMetadata?: string;
  starred?: boolean;
}

/**
 * Self-contained star toggle. PATCHes /api/objects/[id] and keeps an optimistic
 * local flag so the row updates instantly; Dexie catches up on the next sync.
 */
function useStarToggle(item: ObjectData) {
  const [starred, setStarred] = useState(!!item.starred);
  const workspace = useOptionalWorkspace();

  const toggle = useCallback(async () => {
    const next = !starred;
    setStarred(next);
    try {
      const request = {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred: next }),
      };
      const res = workspace?.scopedFetch
        ? await workspace.scopedFetch(`/api/objects/${item.id}`, request)
        : await fetch(`/api/objects/${item.id}`, request);
      if (!res.ok) throw new Error("star failed");
    } catch {
      setStarred(!next); // revert on failure
    }
  }, [starred, item.id, workspace]);

  return { starred, toggle };
}

interface ItemProps {
  item: ObjectData;
  viewMode: "list" | "grid";
  currentPrefix: string;
  onNavigate?: (path: string) => void;
  onPreview?: (item: ObjectData) => void;
  onDownload?: (item: ObjectData) => void;
  onDelete?: (item: ObjectData) => void;
  onTag?: (item: ObjectData) => void;
  onCut?: (item: ObjectData) => void;
  isDownloading?: boolean;
  style?: React.CSSProperties;
  dragHandleProps?: any;
  isOverlay?: boolean;
  isSelected?: boolean;
  onSelect?: (item: ObjectData, e: React.MouseEvent) => void;
  registerItemRef?: (id: string, el: HTMLElement | null) => void;
  onShare?: (item: ObjectData) => void;
  mobileContextOpen?: boolean;
  onMobileContextOpenChange?: (open: boolean) => void;
}

function useIsCoarsePointer() {
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mediaQuery = window.matchMedia("(pointer: coarse)");
    const update = () => setIsCoarsePointer(mediaQuery.matches);
    update();

    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return isCoarsePointer;
}

// ─── Presentational Component — List View ─────────────────────────────────────

export const FileRow = forwardRef<HTMLTableRowElement, ItemProps>(
  (
    {
      item,
      currentPrefix,
      onNavigate,
      onPreview,
      onDownload,
      onDelete,
      onTag,
      onCut,
      style,
      dragHandleProps,
      isOverlay,
      isSelected,
      onSelect,
      onShare,
      mobileContextOpen,
      onMobileContextOpenChange,
    },
    ref,
  ) => {
    const isFolder =
      item.contentType === "application/x-directory" || item.key.endsWith("/");

    const { isUnlocked, metadataKey } = useCrypto();
    const workspaceSpaceKey = useWorkspaceSpaceKey();
    const activeMetadataKey = workspaceSpaceKey.cryptoKey ?? metadataKey;
    const [decryptedName, setDecryptedName] = useState<string | null>(null);
    const [decryptedTags, setDecryptedTags] = useState<string[] | null>(null);
    const [visibilityRef, isVisible] = useIsVisible();
    const decryptedThumbnail = useThumbnail(
      isVisible ? item.thumbnail : undefined,
      activeMetadataKey,
    );
    const [isMetaOpen, setIsMetaOpen] = useState(false);
    const { starred, toggle: toggleStar } = useStarToggle(item);
    const isCoarsePointer = useIsCoarsePointer();

    useEffect(() => {
      if (isUnlocked && activeMetadataKey) {
        const isFolder =
          item.contentType === "application/x-directory" ||
          item.key.endsWith("/");
        const nameToDecrypt = isFolder
          ? item.encryptedDisplayName
          : item.isEncrypted
            ? item.encryptedName
            : null;

        if (nameToDecrypt) {
          decryptMetadataString(nameToDecrypt, activeMetadataKey).then(
            setDecryptedName,
          );
        } else {
          setDecryptedName(null);
        }

        if (item.tags && item.tags.length > 0 && activeMetadataKey) {
          Promise.all(
            item.tags.map((t) => decryptMetadataString(t, activeMetadataKey)),
          ).then(setDecryptedTags);
        } else {
          setDecryptedTags(null);
        }
      } else {
        setDecryptedName(null);
        setDecryptedTags(null);
      }
    }, [
      item.isEncrypted,
      item.encryptedName,
      item.encryptedDisplayName,
      item.tags,
      isUnlocked,
      activeMetadataKey,
    ]);

    let baseName = item.key;
    if (item.id.startsWith("virtual-")) {
      baseName = item.id.replace("virtual-", "");
    } else {
      baseName =
        item.key
          .slice(currentPrefix.length)
          .replace(/\/$/, "")
          .split("/")
          .pop() || item.key;
    }

    const name = decryptedName || baseName;

    const defaultActions = (
      <>
        {onCut && (
          <>
            <ContextMenuSeparator className="bg-border" />
            <ContextMenuItem
              className="hover:bg-accent cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onCut(item);
              }}
            >
              <Scissors className="w-4 h-4 mr-2" />
              Cut
            </ContextMenuItem>
          </>
        )}
        {!item.id.startsWith("virtual-") && (
          <ContextMenuItem
            className="hover:bg-accent cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onTag?.(item);
            }}
          >
            <Tag className="w-4 h-4 mr-2" />
            Tags
          </ContextMenuItem>
        )}
        {onDelete && (
          <>
            <ContextMenuSeparator className="bg-border" />
            <ContextMenuItem
              className="text-destructive hover:bg-destructive/10 cursor-pointer focus:bg-destructive/10 focus:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(item);
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </ContextMenuItem>
          </>
        )}
      </>
    );

    const content = (
      <TableRow
        ref={(el) => {
          // Forward both the parent ref and the visibility observer ref
          if (typeof ref === "function") ref(el);
          else if (ref) (ref as React.MutableRefObject<HTMLTableRowElement | null>).current = el;
          visibilityRef(el);
        }}
        style={style}
        {...dragHandleProps}
        data-id={item.id}
        className={`file-item-selectable border-border cursor-pointer group select-none relative transition-colors ${
          isOverlay
            ? "bg-card opacity-90 shadow-xl flex items-center w-full"
            : isSelected
              ? "bg-primary/20 hover:bg-primary/30"
              : "hover:bg-accent"
        }`}
        onClick={(e) => {
          if (isCoarsePointer) {
            if (mobileContextOpen) {
              e.stopPropagation();
              e.preventDefault();
              return;
            }
            if (isFolder && onNavigate) {
              onNavigate(name);
            } else if (!isFolder && onPreview) {
              onPreview(item);
            }
            return;
          }
          if (onSelect) {
            onSelect(item, e);
            return;
          }
          if (isFolder && onNavigate) {
            onNavigate(name);
          } else if (!isFolder && onPreview) {
            onPreview(item);
          }
        }}
        onDoubleClick={(e) => {
          if (isFolder && onNavigate) {
            onNavigate(name);
          } else if (!isFolder && onPreview) {
            onPreview(item);
          }
        }}
      >
        {/* ── Checkbox cell ── */}
        <TableCell className="w-10 pl-4 pr-0">
          <div
            className={cn(
              "transition-opacity duration-150",
              isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={!!isSelected}
              onCheckedChange={() => {}}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.(item, {
                  ...e,
                  ctrlKey: true,
                  stopPropagation: () => e.stopPropagation(),
                  preventDefault: () => e.preventDefault(),
                } as unknown as React.MouseEvent);
              }}
              className="border-muted-foreground/30 data-[state=checked]:bg-primary"
            />
          </div>
        </TableCell>

        {/* ── Name cell ── */}
        <TableCell className="w-[45%] min-w-0">
          <div className="flex items-center gap-3 text-foreground font-medium">
            {isFolder ? (
              <Folder className="w-5 h-5 text-primary fill-primary/20" />
            ) : decryptedThumbnail ? (
              <img
                src={decryptedThumbnail}
                alt={name}
                className="w-8 h-8 rounded object-cover border border-border"
              />
            ) : (
              getFileIcon(item.contentType, "w-4 h-4 ", item.mediaCategory)
            )}

            <span className="truncate block max-w-[300px]">{name}</span>

            {starred && (
              <Star className="fill-primary text-primary h-3.5 w-3.5 shrink-0" />
            )}

            {/* {item.isEncrypted && (
              <Lock className="h-3 w-3 shrink-0 text-primary/60" />
            )} */}

            {(decryptedTags || item.tags) &&
              (decryptedTags || item.tags)!.length > 0 && (
                <div className="flex gap-1">
                  {(decryptedTags || item.tags)!.map((tag) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="text-[10px] h-4 px-1 border-primary/30 text-primary"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
          </div>
        </TableCell>

        <TableCell className="text-muted-foreground w-[15%]">
          {isFolder ? "-" : formatBytes(item.size)}
        </TableCell>

        <TableCell className="text-muted-foreground w-[15%]">
          {isFolder ? (
            "Folder"
          ) : (
            <Badge
              variant="secondary"
              className="bg-secondary text-muted-foreground border-0 text-xs"
            >
              {item.contentType.split("/").pop()}
            </Badge>
          )}
        </TableCell>

        <TableCell className="text-muted-foreground text-sm w-[20%] hidden md:table-cell">
          {formatDate(item.createdAt)}
        </TableCell>

        <TableCell className="text-right w-[100px]">
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {!isFolder && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-md border border-border bg-background/90 text-foreground shadow-sm hover:bg-primary hover:text-primary-foreground dark:border-white/15 dark:bg-zinc-900/90 dark:text-zinc-100 dark:shadow-black/40 dark:hover:bg-primary dark:hover:text-primary-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview?.(item);
                }}
              >
                <FileText className="w-4 h-4" />
              </Button>
            )}
            {!isFolder && (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-md border border-border bg-background/90 text-foreground shadow-sm hover:bg-primary hover:text-primary-foreground dark:border-white/15 dark:bg-zinc-900/90 dark:text-zinc-100 dark:shadow-black/40 dark:hover:bg-primary dark:hover:text-primary-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onShare?.(item);
                }}
              >
                <Link2 className="w-4 h-4" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 rounded-md border border-border bg-background/90 text-foreground shadow-sm hover:bg-primary hover:text-primary-foreground dark:border-white/15 dark:bg-zinc-900/90 dark:text-zinc-100 dark:shadow-black/40 dark:hover:bg-primary dark:hover:text-primary-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onTag?.(item);
              }}
            >
              <Tag className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 rounded-md border border-border bg-background/90 text-foreground shadow-sm hover:bg-primary hover:text-primary-foreground dark:border-white/15 dark:bg-zinc-900/90 dark:text-zinc-100 dark:shadow-black/40 dark:hover:bg-primary dark:hover:text-primary-foreground"
              onClick={(e) => {
                e.stopPropagation();
                setIsMetaOpen(true);
              }}
            >
              <Info className="w-4 h-4" />
            </Button>
          </div>
          <MetadataDialog
            item={item}
            isOpen={isMetaOpen}
            onOpenChange={setIsMetaOpen}
            metadataKey={activeMetadataKey}
          />
        </TableCell>
      </TableRow>
    );

    if (isOverlay) {
      return (
        <div className="flex items-center bg-card border border-border p-2 rounded-lg shadow-xl w-[600px]">
          <div className="flex items-center gap-3 text-foreground font-medium flex-1">
            {isFolder ? (
              <Folder className="w-5 h-5 text-primary fill-primary/20" />
            ) : (
              getFileIcon(item.contentType, "w-4 h-4", item.mediaCategory)
            )}
            <span>{name}</span>
          </div>
        </div>
      );
    }

    return (
      <ContextMenu onOpenChange={onMobileContextOpenChange}>
        <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
        <ContextMenuContent className="w-64 bg-card border-border text-foreground">
          {isFolder ? (
            <ContextMenuItem
              className="hover:bg-accent cursor-pointer"
              onClick={() => onNavigate?.(name)}
            >
              <Folder className="w-4 h-4 mr-2" /> Open
            </ContextMenuItem>
          ) : (
            <>
              <ContextMenuItem
                className="hover:bg-accent cursor-pointer"
                onSelect={() => {
                  setTimeout(() => onPreview?.(item), 50);
                }}
              >
                <FileText className="w-4 h-4 mr-2" /> Preview
              </ContextMenuItem>
              <ContextMenuItem
                className="hover:bg-accent cursor-pointer"
                onSelect={() => {
                  setTimeout(() => onDownload?.(item), 50);
                }}
              >
                <DownloadCloud className="w-4 h-4 mr-2" /> Download
              </ContextMenuItem>
              <ContextMenuItem
                className="hover:bg-accent cursor-pointer"
                onSelect={() => {
                  setTimeout(() => onShare?.(item), 50);
                }}
              >
                <Link2 className="w-4 h-4 mr-2" /> Share
              </ContextMenuItem>
              <ContextMenuItem
                className="hover:bg-accent cursor-pointer"
                onSelect={() => {
                  setTimeout(toggleStar, 50);
                }}
              >
                <Star
                  className={`w-4 h-4 mr-2 ${starred ? "fill-primary text-primary" : ""}`}
                />{" "}
                {starred ? "Unstar" : "Star"}
              </ContextMenuItem>
            </>
          )}
          {defaultActions}
        </ContextMenuContent>
      </ContextMenu>
    );
  },
);
FileRow.displayName = "FileRow";

// ─── Presentational Component — Grid View ─────────────────────────────────────

export const FileCard = forwardRef<HTMLDivElement, ItemProps>(
  (
    {
      item,
      currentPrefix,
      onNavigate,
      onPreview,
      onDownload,
      onDelete,
      onTag,
      onCut,
      style,
      dragHandleProps,
      isOverlay,
      isSelected,
      onSelect,
      onShare,
      mobileContextOpen,
      onMobileContextOpenChange,
    },
    ref,
  ) => {
    const isFolder =
      item.contentType === "application/x-directory" || item.key.endsWith("/");

    const { isUnlocked, metadataKey } = useCrypto();
    const workspaceSpaceKey = useWorkspaceSpaceKey();
    const activeMetadataKey = workspaceSpaceKey.cryptoKey ?? metadataKey;
    const [decryptedName, setDecryptedName] = useState<string | null>(null);
    const [decryptedTags, setDecryptedTags] = useState<string[] | null>(null);
    const [visibilityRef, isVisible] = useIsVisible();
    const decryptedThumbnail = useThumbnail(
      isVisible ? item.thumbnail : undefined,
      activeMetadataKey,
    );
    const [isMetaOpen, setIsMetaOpen] = useState(false);
    const { starred, toggle: toggleStar } = useStarToggle(item);
    const isCoarsePointer = useIsCoarsePointer();

    useEffect(() => {
      if (isUnlocked && activeMetadataKey) {
        const isFolder =
          item.contentType === "application/x-directory" ||
          item.key.endsWith("/");
        const nameToDecrypt = isFolder
          ? item.encryptedDisplayName
          : item.isEncrypted
            ? item.encryptedName
            : null;

        if (nameToDecrypt) {
          decryptMetadataString(nameToDecrypt, activeMetadataKey).then(
            setDecryptedName,
          );
        } else {
          setDecryptedName(null);
        }

        if (item.tags && item.tags.length > 0 && activeMetadataKey) {
          Promise.all(
            item.tags.map((t) => decryptMetadataString(t, activeMetadataKey)),
          ).then(setDecryptedTags);
        } else {
          setDecryptedTags(null);
        }
      } else {
        setDecryptedName(null);
        setDecryptedTags(null);
      }
    }, [
      item.isEncrypted,
      item.encryptedName,
      item.encryptedDisplayName,
      item.tags,
      isUnlocked,
      activeMetadataKey,
    ]);

    let baseName = item.key;
    if (item.id.startsWith("virtual-")) {
      baseName = item.id.replace("virtual-", "");
    } else {
      baseName =
        item.key
          .slice(currentPrefix.length)
          .replace(/\/$/, "")
          .split("/")
          .pop() || item.key;
    }

    const name = decryptedName || baseName;

    const defaultActions = (
      <>
        {onCut && (
          <>
            <ContextMenuSeparator className="bg-border" />
            <ContextMenuItem
              className="hover:bg-accent cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onCut(item);
              }}
            >
              <Scissors className="w-4 h-4 mr-2" />
              Cut
            </ContextMenuItem>
          </>
        )}
        {!item.id.startsWith("virtual-") && (
          <ContextMenuItem
            className="hover:bg-accent cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onTag?.(item);
            }}
          >
            <Tag className="w-4 h-4 mr-2" />
            Tags
          </ContextMenuItem>
        )}
        {onDelete && (
          <>
            <ContextMenuSeparator className="bg-border" />
            <ContextMenuItem
              className="text-destructive hover:bg-destructive/10 cursor-pointer focus:bg-destructive/10 focus:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(item);
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </ContextMenuItem>
          </>
        )}
      </>
    );

    const content = (
      <div
        ref={(el) => {
          if (typeof ref === "function") ref(el);
          else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
          visibilityRef(el);
        }}
        style={style}
        {...dragHandleProps}
        onClick={(e) => {
          if (isCoarsePointer) {
            if (mobileContextOpen) {
              e.stopPropagation();
              e.preventDefault();
              return;
            }
            if (isFolder && onNavigate) {
              onNavigate(name);
            } else if (!isFolder && onPreview) {
              onPreview(item);
            }
            return;
          }
          if (onSelect) {
            onSelect(item, e);
            return;
          }
          if (isFolder && onNavigate) {
            onNavigate(name);
          } else if (!isFolder && onPreview) {
            onPreview(item);
          }
        }}
        onDoubleClick={(e) => {
          if (isFolder && onNavigate) {
            onNavigate(name);
          } else if (!isFolder && onPreview) {
            onPreview(item);
          }
        }}
        data-id={item.id}
        className={`file-item-selectable aspect-square rounded-xl border flex flex-col items-center justify-center cursor-pointer transition-all hover:scale-[1.02] p-4 group relative select-none ${
          isOverlay
            ? "opacity-90 shadow-xl scale-105 bg-card border-border"
            : isSelected
              ? "bg-primary/20 border-primary/50 hover:bg-primary/30"
              : "bg-card border-border hover:bg-card/80"
        }`}
      >
        {/* ── Checkbox — top-left, fades in on hover or stays when selected ── */}
        <div
          className={cn(
            "absolute top-2 left-2 z-10 transition-opacity duration-150",
            isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={!!isSelected}
            onCheckedChange={() => {}}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(item, {
                ...e,
                ctrlKey: true,
                stopPropagation: () => e.stopPropagation(),
                preventDefault: () => e.preventDefault(),
              } as unknown as React.MouseEvent);
            }}
            className="border-muted-foreground/40 bg-background/90 shadow-sm backdrop-blur-sm data-[state=checked]:bg-primary dark:border-white/25 dark:bg-zinc-900/90 dark:data-[state=checked]:bg-primary"
          />
        </div>

        {/* ── Content ── */}
        {isFolder ? (
          <>
            <Folder className="w-12 h-12 text-primary mb-3 fill-primary/20 transition-transform group-hover:scale-110" />
            <span className="text-foreground font-medium text-sm text-center truncate w-full px-2">
              {name}
            </span>
            <span className="text-muted-foreground text-xs mt-1">
              Folder
            </span>
          </>
        ) : (
          <>
            <div className="flex-1 flex items-center justify-center w-full p-4 pb-0 overflow-hidden">
              {decryptedThumbnail ? (
                <img
                  src={decryptedThumbnail}
                  alt={name}
                  className="w-full h-full object-contain rounded"
                />
              ) : item.contentType.startsWith("image/") ||
                item.contentType.startsWith("video/") ? (
                <div className="relative w-full h-full flex items-center justify-center">
                  {getFileIcon(
                    item.contentType,
                    "w-10 h-10",
                    item.mediaCategory,
                  )}
                </div>
              ) : (
                getFileIcon(item.contentType, "w-10 h-10", item.mediaCategory)
              )}
            </div>
            <div className="w-full flex flex-col items-center gap-0.5 mt-2">
              <span className="text-foreground font-medium text-sm text-center truncate w-full px-2">
                {name}
              </span>
              <span className="text-muted-foreground text-xs mt-1">
                {formatBytes(item.size)}
              </span>
            </div>
          </>
        )}

        {/* ── Encrypted badge — bottom-left (no longer overlaps with checkbox) ── */}
        {/* {item.isEncrypted && !isFolder && (
          <div className="absolute bottom-2 left-2">
            <Lock className="h-3 w-3 text-primary/70" aria-label="Encrypted" />
          </div>
        )} */}

        {/* ── Tag dots — bottom-right ── */}
        {(decryptedTags || item.tags) &&
          (decryptedTags || item.tags)!.length > 0 && (
            <div className="flex gap-1 absolute bottom-2 right-2">
              {(decryptedTags || item.tags)!.slice(0, 3).map((tag) => (
                <div
                  key={tag}
                  className="w-1.5 h-1.5 rounded-full bg-primary"
                  title={tag}
                />
              ))}
            </div>
          )}

        {/* ── Action overlay (hover, top-right) ── */}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex-col gap-1.5 hidden md:flex">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-md border border-border bg-background/90 text-foreground shadow-sm backdrop-blur-sm hover:bg-primary hover:text-primary-foreground dark:border-white/15 dark:bg-zinc-900/90 dark:text-zinc-100 dark:shadow-black/40 dark:hover:bg-primary dark:hover:text-primary-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onCut?.(item);
            }}
          >
            <Scissors className="w-3.5 h-3.5" />
          </Button>

          {!item.id.startsWith("virtual-") && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-md border border-border bg-background/90 text-foreground shadow-sm backdrop-blur-sm hover:bg-primary hover:text-primary-foreground dark:border-white/15 dark:bg-zinc-900/90 dark:text-zinc-100 dark:shadow-black/40 dark:hover:bg-primary dark:hover:text-primary-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onTag?.(item);
              }}
            >
              <Tag className="w-3.5 h-3.5" />
            </Button>
          )}

          {!isFolder && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-md border border-border bg-background/90 text-foreground shadow-sm backdrop-blur-sm hover:bg-primary hover:text-primary-foreground dark:border-white/15 dark:bg-zinc-900/90 dark:text-zinc-100 dark:shadow-black/40 dark:hover:bg-primary dark:hover:text-primary-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onShare?.(item);
              }}
            >
              <Link2 className="w-3.5 h-3.5" />
            </Button>
          )}

          {onDelete && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-md border border-border !bg-background/90 !text-foreground shadow-sm backdrop-blur-sm hover:!border-destructive/40 hover:!bg-destructive/10 hover:!text-destructive dark:!border-white/15 dark:!bg-zinc-900/90 dark:!text-zinc-100 dark:shadow-black/40 dark:hover:!border-destructive/50 dark:hover:!bg-red-950/70 dark:hover:!text-red-200 dark:focus-visible:!bg-zinc-900/90 dark:data-[state=open]:!bg-zinc-900/90"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(item);
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}

          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-md border border-border bg-background/90 text-foreground shadow-sm backdrop-blur-sm hover:bg-primary hover:text-primary-foreground dark:border-white/15 dark:bg-zinc-900/90 dark:text-zinc-100 dark:shadow-black/40 dark:hover:bg-primary dark:hover:text-primary-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setIsMetaOpen(true);
            }}
          >
            <Info className="w-3.5 h-3.5" />
          </Button>

          <MetadataDialog
            item={item}
            isOpen={isMetaOpen}
            onOpenChange={setIsMetaOpen}
            metadataKey={activeMetadataKey}
          />
        </div>
      </div>
    );

    if (isOverlay) return content;

    return (
      <ContextMenu onOpenChange={onMobileContextOpenChange}>
        <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
        <ContextMenuContent className="w-64 bg-card border-border text-foreground">
          {isFolder ? (
            <ContextMenuItem
              className="hover:bg-accent cursor-pointer"
              onClick={() => onNavigate?.(name)}
            >
              <Folder className="w-4 h-4 mr-2" /> Open
            </ContextMenuItem>
          ) : (
            <>
              <ContextMenuItem
                className="hover:bg-accent cursor-pointer"
                onSelect={() => {
                  setTimeout(() => onPreview?.(item), 50);
                }}
              >
                <FileText className="w-4 h-4 mr-2" /> Preview
              </ContextMenuItem>
              <ContextMenuItem
                className="hover:bg-accent cursor-pointer"
                onSelect={() => {
                  setTimeout(() => onDownload?.(item), 50);
                }}
              >
                <DownloadCloud className="w-4 h-4 mr-2" /> Download
              </ContextMenuItem>
              <ContextMenuItem
                className="hover:bg-accent cursor-pointer"
                onSelect={() => {
                  setTimeout(() => onShare?.(item), 50);
                }}
              >
                <Link2 className="w-4 h-4 mr-2" /> Share
              </ContextMenuItem>
              <ContextMenuItem
                className="hover:bg-accent cursor-pointer"
                onSelect={() => {
                  setTimeout(toggleStar, 50);
                }}
              >
                <Star
                  className={`w-4 h-4 mr-2 ${starred ? "fill-primary text-primary" : ""}`}
                />{" "}
                {starred ? "Unstar" : "Star"}
              </ContextMenuItem>
            </>
          )}
          {defaultActions}
        </ContextMenuContent>
      </ContextMenu>
    );
  },
);
FileCard.displayName = "FileCard";

// ─── DnD + Long Press wrapper ─────────────────────────────────────────────────

export const FileItemInner = memo(function FileItemInner(props: ItemProps) {
  const { registerItemRef } = props;
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const isCoarsePointer = useIsCoarsePointer();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props.item.id,
    data: props.item,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.3 : 1,
  };

  const handleProps = { ...attributes, ...listeners };

  const refCallback = (el: HTMLElement | null) => {
    setNodeRef(el);
    registerItemRef?.(props.item.id, el);
  };

  // Mobile Long Press Hook
  const useLongPress = (
    callback: (e: React.TouchEvent | React.MouseEvent) => void,
    ms = 500,
  ) => {
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const start = useCallback(
      (e: React.TouchEvent | React.MouseEvent) => {
        if (
          (e.type === "touchstart" &&
            (e as React.TouchEvent).touches.length > 1) ||
          (e as React.MouseEvent).button !== 0
        ) {
          return;
        }

        e.persist();
        timerRef.current = setTimeout(() => {
          callback(e);
        }, ms);
      },
      [callback, ms],
    );

    const stop = useCallback(() => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }, []);

    return {
      onMouseDown: start,
      onMouseUp: stop,
      onMouseLeave: stop,
      onTouchStart: start,
      onTouchEnd: stop,
      onTouchMove: stop,
    };
  };

  const openContextMenuAtEvent = (e: React.TouchEvent | React.MouseEvent) => {
    const target = e.currentTarget;
    if (!(target instanceof HTMLElement)) return;

    let clientX: number;
    let clientY: number;

    if ("touches" in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ("changedTouches" in e && e.changedTouches.length > 0) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else if ("clientX" in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    } else {
      return;
    }

    target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
      }),
    );
  };

  const onLongPress = (e: React.TouchEvent | React.MouseEvent) => {
    if (props.onSelect) {
      const mockEvent = {
        ...e,
        ctrlKey: true,
        stopPropagation: () => e.stopPropagation(),
        preventDefault: () => e.preventDefault(),
      } as unknown as React.MouseEvent;

      props.onSelect(props.item, mockEvent);
      if (isCoarsePointer || e.type.startsWith("touch")) {
        setMobileContextOpen(true);
        openContextMenuAtEvent(e);
      }

      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(50);
      }
    }
  };

  const longPressProps = useLongPress(onLongPress);

  const mergedHandleProps = {
    ...handleProps,
    ...longPressProps,
  };

  if (props.viewMode === "list") {
    return (
      <FileRow
        ref={refCallback}
        style={style}
        dragHandleProps={mergedHandleProps}
        mobileContextOpen={mobileContextOpen}
        onMobileContextOpenChange={setMobileContextOpen}
        {...props}
      />
    );
  }

  return (
    <FileCard
      ref={refCallback}
      style={style}
      dragHandleProps={mergedHandleProps}
      mobileContextOpen={mobileContextOpen}
      onMobileContextOpenChange={setMobileContextOpen}
      {...props}
    />
  );
});
FileItemInner.displayName = "FileItemInner";

export function FileItem(props: ItemProps & { isScrolling?: boolean }) {
  // If a row mounts while actively scrolling, it starts as NOT ready.
  // If it's already mounted (or scrolling is false), it starts as ready.
  // This ensures we never replace an already-loaded row with a skeleton.
  const [isReady, setIsReady] = useState(!props.isScrolling);

  useEffect(() => {
    // Once scrolling stops, mark as ready so it loads the full component.
    // It stays ready forever after this.
    if (!props.isScrolling && !isReady) {
      setIsReady(true);
    }
  }, [props.isScrolling, isReady]);

  if (!isReady) {
    if (props.viewMode === "list") {
      return <SkeletonRow />;
    }
    return <SkeletonCard />;
  }

  // Omit isScrolling so the memoized inner component doesn't re-render 
  // on every scroll frame when already ready.
  const { isScrolling, ...innerProps } = props;
  return <FileItemInner {...innerProps} />;
}
FileItem.displayName = "FileItem";

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
} from "lucide-react";
import { formatBytes, formatDate, cn } from "@/lib/utils";
import { getFileIcon } from "@/lib/file-icons";
import { forwardRef, useRef, useCallback, useState, useEffect } from "react";
import { useCrypto } from "@/contexts/CryptoContext";
import {
  decryptFileName,
  decryptMetadataString,
} from "@/lib/crypto/fileEncryption";
import { useThumbnail } from "@/hooks/useThumbnail";

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
    },
    ref,
  ) => {
    const isFolder =
      item.contentType === "application/x-directory" || item.key.endsWith("/");

    const { isUnlocked, metadataKey } = useCrypto();
    const [decryptedName, setDecryptedName] = useState<string | null>(null);
    const [decryptedTags, setDecryptedTags] = useState<string[] | null>(null);
    const decryptedThumbnail = useThumbnail(item.thumbnail, metadataKey);

    useEffect(() => {
      if (isUnlocked && metadataKey) {
        const isFolder =
          item.contentType === "application/x-directory" ||
          item.key.endsWith("/");
        const nameToDecrypt = isFolder
          ? item.encryptedDisplayName
          : item.isEncrypted
            ? item.encryptedName
            : null;

        if (nameToDecrypt) {
          decryptMetadataString(nameToDecrypt, metadataKey).then(
            setDecryptedName,
          );
        } else {
          setDecryptedName(null);
        }

        if (item.tags && item.tags.length > 0 && metadataKey) {
          Promise.all(
            item.tags.map((t) => decryptMetadataString(t, metadataKey)),
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
      metadataKey,
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
        <ContextMenuSeparator className="bg-border" />
        <ContextMenuItem
          className="hover:bg-accent cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onCut?.(item);
          }}
        >
          <Scissors className="w-4 h-4 mr-2" />
          Cut
        </ContextMenuItem>
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
        <ContextMenuSeparator className="bg-border" />
        <ContextMenuItem
          className="text-destructive hover:bg-destructive/10 cursor-pointer focus:bg-destructive/10 focus:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.(item);
          }}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete
        </ContextMenuItem>
      </>
    );

    const content = (
      <TableRow
        ref={ref}
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

        <TableCell className="text-muted-foreground/40 w-[15%]">
          {isFolder ? "-" : formatBytes(item.size)}
        </TableCell>

        <TableCell className="text-muted-foreground/40 w-[15%]">
          {isFolder ? (
            "Folder"
          ) : (
            <Badge
              variant="secondary"
              className="bg-secondary text-muted-foreground/50 border-0 text-xs"
            >
              {item.contentType.split("/").pop()}
            </Badge>
          )}
        </TableCell>

        <TableCell className="text-muted-foreground/40 text-sm w-[20%] hidden md:table-cell">
          {formatDate(item.createdAt)}
        </TableCell>

        <TableCell className="text-right w-[100px]">
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {!isFolder && (
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview?.(item);
                }}
              >
                <FileText className="w-4 h-4 text-muted-foreground/40 hover:text-primary" />
              </Button>
            )}
            {!isFolder && (
              <Button
                size="icon"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onShare?.(item);
                }}
              >
                <Link2 className="w-4 h-4 text-muted-foreground/40 hover:text-primary" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onTag?.(item);
              }}
            >
              <Tag className="w-4 h-4" />
            </Button>
          </div>
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
      <ContextMenu>
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
                onClick={() => onPreview?.(item)}
              >
                <FileText className="w-4 h-4 mr-2" /> Preview
              </ContextMenuItem>
              <ContextMenuItem
                className="hover:bg-accent cursor-pointer"
                onClick={() => onDownload?.(item)}
              >
                <DownloadCloud className="w-4 h-4 mr-2" /> Download
              </ContextMenuItem>
              <ContextMenuItem
                className="hover:bg-accent cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onShare?.(item);
                }}
              >
                <Link2 className="w-4 h-4 mr-2" /> Share
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
    },
    ref,
  ) => {
    const isFolder =
      item.contentType === "application/x-directory" || item.key.endsWith("/");

    const { isUnlocked, metadataKey } = useCrypto();
    const [decryptedName, setDecryptedName] = useState<string | null>(null);
    const [decryptedTags, setDecryptedTags] = useState<string[] | null>(null);
    const decryptedThumbnail = useThumbnail(item.thumbnail, metadataKey);

    useEffect(() => {
      if (isUnlocked && metadataKey) {
        const isFolder =
          item.contentType === "application/x-directory" ||
          item.key.endsWith("/");
        const nameToDecrypt = isFolder
          ? item.encryptedDisplayName
          : item.isEncrypted
            ? item.encryptedName
            : null;

        if (nameToDecrypt) {
          decryptMetadataString(nameToDecrypt, metadataKey).then(
            setDecryptedName,
          );
        } else {
          setDecryptedName(null);
        }

        if (item.tags && item.tags.length > 0 && metadataKey) {
          Promise.all(
            item.tags.map((t) => decryptMetadataString(t, metadataKey)),
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
      metadataKey,
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
        <ContextMenuSeparator className="bg-white/10" />
        <ContextMenuItem
          className="hover:bg-white/10 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onCut?.(item);
          }}
        >
          <Scissors className="w-4 h-4 mr-2" />
          Cut
        </ContextMenuItem>
        {!item.id.startsWith("virtual-") && (
          <ContextMenuItem
            className="hover:bg-white/10 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onTag?.(item);
            }}
          >
            <Tag className="w-4 h-4 mr-2" />
            Tags
          </ContextMenuItem>
        )}
        <ContextMenuSeparator className="bg-white/10" />
        <ContextMenuItem
          className="text-red-400 hover:bg-red-400/10 cursor-pointer focus:bg-red-400/10 focus:text-red-400"
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.(item);
          }}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete
        </ContextMenuItem>
      </>
    );

    const content = (
      <div
        ref={ref}
        style={style}
        {...dragHandleProps}
        onClick={(e) => {
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
            className="border-muted-foreground/40 data-[state=checked]:bg-primary bg-black/30 backdrop-blur-sm"
          />
        </div>

        {/* ── Content ── */}
        {isFolder ? (
          <>
            <Folder className="w-12 h-12 text-primary mb-3 fill-primary/20 transition-transform group-hover:scale-110" />
            <span className="text-foreground font-medium text-sm text-center truncate w-full px-2">
              {name}
            </span>
            <span className="text-muted-foreground/40 text-xs mt-1">
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
              <span className="text-muted-foreground/40 text-xs mt-1">
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
            className="h-7 w-7 rounded-md bg-black/50 hover:bg-primary hover:text-primary-foreground text-foreground backdrop-blur-sm"
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
              className="h-7 w-7 rounded-md bg-black/50 hover:bg-primary hover:text-primary-foreground text-foreground backdrop-blur-sm"
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
              className="h-7 w-7 rounded-md bg-black/50 hover:bg-primary hover:text-primary-foreground text-foreground backdrop-blur-sm"
              onClick={(e) => {
                e.stopPropagation();
                onShare?.(item);
              }}
            >
              <Link2 className="w-3.5 h-3.5" />
            </Button>
          )}

          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-md bg-black/50 hover:bg-destructive hover:text-destructive-foreground text-foreground backdrop-blur-sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(item);
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    );

    if (isOverlay) return content;

    return (
      <ContextMenu>
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
                onClick={() => onPreview?.(item)}
              >
                <FileText className="w-4 h-4 mr-2" /> Preview
              </ContextMenuItem>
              <ContextMenuItem
                className="hover:bg-accent cursor-pointer"
                onClick={() => onDownload?.(item)}
              >
                <DownloadCloud className="w-4 h-4 mr-2" /> Download
              </ContextMenuItem>
              <ContextMenuItem
                className="hover:bg-accent cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onShare?.(item);
                }}
              >
                <Link2 className="w-4 h-4 mr-2" /> Share
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

export function FileItem(props: ItemProps) {
  const { registerItemRef } = props;

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

  const onLongPress = (e: React.TouchEvent | React.MouseEvent) => {
    if (props.onSelect) {
      const mockEvent = {
        ...e,
        ctrlKey: true,
        stopPropagation: () => e.stopPropagation(),
        preventDefault: () => e.preventDefault(),
      } as unknown as React.MouseEvent;

      props.onSelect(props.item, mockEvent);

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
        {...props}
      />
    );
  }

  return (
    <FileCard
      ref={refCallback}
      style={style}
      dragHandleProps={mergedHandleProps}
      {...props}
    />
  );
}

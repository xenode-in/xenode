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
import { TableRow, TableCell } from "@/components/ui/table";
import {
  Folder,
  FileText,
  DownloadCloud,
  Trash2,
  Tag,
  Scissors,
  Lock,
  Link2,
  Image as ImageIcon,
  Video,
  Music,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  File as FileGeneric,
} from "lucide-react";
import { formatBytes, formatDate } from "@/lib/utils";
import { forwardRef, useRef, useCallback, useState, useEffect } from "react";
import { useCrypto } from "@/contexts/CryptoContext";
import { decryptFileName } from "@/lib/crypto/fileEncryption";

const getFileIcon = (contentType: string, className?: string) => {
  if (!contentType) return <FileGeneric className={className} />;
  if (contentType === "application/x-directory")
    return <Folder className={className} />;

  if (contentType.startsWith("image/"))
    return <ImageIcon className={`text-blue-400! ${className || ""}`} />;
  if (contentType.startsWith("video/"))
    return <Video className={`text-purple-400! ${className || ""}`} />;
  if (contentType.startsWith("audio/"))
    return <Music className={`text-green-400! ${className || ""}`} />;
  if (contentType.includes("pdf") || contentType.includes("document"))
    return <FileText className={`text-red-400! ${className || ""}`} />;

  if (
    contentType.includes("zip") ||
    contentType.includes("tar") ||
    contentType.includes("rar") ||
    contentType.includes("7z") ||
    contentType.includes("compressed") ||
    contentType.includes("archive")
  ) {
    return <FileArchive className={`text-yellow-500 ${className || ""}`} />;
  }
  if (
    contentType.includes("javascript") ||
    contentType.includes("json") ||
    contentType.includes("html") ||
    contentType.includes("css") ||
    contentType.includes("xml") ||
    contentType.includes("yaml") ||
    contentType.includes("typescript")
  ) {
    return <FileCode className={`text-orange-400 ${className || ""}`} />;
  }
  if (
    contentType.includes("spreadsheet") ||
    contentType.includes("excel") ||
    contentType.includes("csv")
  ) {
    return (
      <FileSpreadsheet className={`text-emerald-500 ${className || ""}`} />
    );
  }
  if (contentType.startsWith("text/"))
    return (
      <FileText className={`text-muted-foreground/50 ${className || ""}`} />
    );

  return (
    <FileGeneric className={`text-muted-foreground/50 ${className || ""}`} />
  );
};

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
  encryptedName?: string;
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

// Presentational Component for List View
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

    const { isUnlocked } = useCrypto();
    const [decryptedName, setDecryptedName] = useState<string | null>(null);

    useEffect(() => {
      if (item.isEncrypted && item.encryptedName && isUnlocked) {
        decryptFileName(item.encryptedName).then(setDecryptedName);
      } else {
        // eslint-disable-next-line
        setDecryptedName(null);
      }
    }, [item.isEncrypted, item.encryptedName, isUnlocked]);

    // Virtual folder fallback name
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
        <TableCell className="w-[50%]">
          <div className="flex items-center gap-3 text-foreground font-medium">
            {isFolder ? (
              <Folder className="w-5 h-5 text-primary fill-primary/20" />
            ) : item.thumbnail ? (
              <img
                src={item.thumbnail}
                alt={name}
                className="w-8 h-8 rounded object-cover border border-border"
              />
            ) : (
              getFileIcon(item.contentType, "w-4 h-4 text-muted-foreground/30")
            )}
            <span className="truncate max-w-[300px]">{name}</span>
            {item.isEncrypted && (
              <Lock
                className="h-3 w-3 shrink-0 text-primary/60"
                aria-label="Encrypted"
              />
            )}
            {item.tags && item.tags.length > 0 && (
              <div className="flex gap-1">
                {item.tags.map((tag) => (
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
        <TableCell className="text-muted-foreground/40 text-sm w-[20%]">
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
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onShare?.(item);
                }}
              >
                <Link2 className="w-4 h-4 text-muted-foreground/40 hover:text-primary" />
              </Button>
            )}
            {!item.id.startsWith("virtual-") && (
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onTag?.(item);
                }}
              >
                <Tag className="w-4 h-4 text-muted-foreground/40 hover:text-primary" />
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>
    );

    if (isOverlay) {
      // Render simplified row for overlay (since TableRow needs Table)
      return (
        <div className="flex items-center bg-card border border-border p-2 rounded-lg shadow-xl w-[600px]">
          <div className="flex items-center gap-3 text-foreground font-medium flex-1">
            {isFolder ? (
              <Folder className="w-5 h-5 text-primary fill-primary/20" />
            ) : (
              getFileIcon(item.contentType, "w-4 h-4 text-muted-foreground/30")
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

// Presentational Component for Grid View
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

    const { isUnlocked } = useCrypto();
    const [decryptedName, setDecryptedName] = useState<string | null>(null);

    useEffect(() => {
      if (item.isEncrypted && item.encryptedName && isUnlocked) {
        decryptFileName(item.encryptedName).then(setDecryptedName);
      } else {
        // eslint-disable-next-line
        setDecryptedName(null);
      }
    }, [item.isEncrypted, item.encryptedName, isUnlocked]);

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
        {/* Content */}
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
              {item.thumbnail ? (
                <img
                  src={item.thumbnail}
                  alt={name}
                  className="w-full h-full object-contain rounded"
                />
              ) : item.contentType.startsWith("image/") ||
                item.contentType.startsWith("video/") ? (
                <div className="relative w-full h-full flex items-center justify-center">
                  {getFileIcon(item.contentType, "w-10 h-10 text-primary")}
                </div>
              ) : (
                getFileIcon(
                  item.contentType,
                  "w-10 h-10 text-muted-foreground/20 group-hover:text-primary transition-colors",
                )
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

        {/* Encrypted badge */}
        {item.isEncrypted && !isFolder && (
          <div className="absolute top-2 left-2">
            <Lock className="h-3 w-3 text-primary/70" aria-label="Encrypted" />
          </div>
        )}

        {/* Tags Indicator */}
        {item.tags && item.tags.length > 0 && (
          <div className="flex gap-1 mt-2 flex-wrap justify-center absolute top-2 left-2">
            {item.tags.slice(0, 3).map((tag) => (
              <div
                key={tag}
                className="w-1.5 h-1.5 rounded-full bg-primary"
                title={tag}
              />
            ))}
          </div>
        )}

        {/* Action Overlay (Hover) */}
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
        // Prevent long press if context menu is triggered or multiple touches
        if (
          (e.type === "touchstart" &&
            (e as React.TouchEvent).touches.length > 1) ||
          (e as React.MouseEvent).button !== 0 // Only left click (or touch)
        ) {
          return;
        }

        e.persist(); // Persist event for async usage if needed
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
      onTouchMove: stop, // Cancel on scroll/move
    };
  };

  const onLongPress = (e: React.TouchEvent | React.MouseEvent) => {
    // Simulate Ctrl+Click for toggle selection
    if (props.onSelect) {
      // Create a synthetic event-like object or modify the real one if possible.
      // Since we can't easily modify React synthetic events, we'll pass a mock.
      // But props.onSelect expects React.MouseEvent.
      // We can cast a custom object.
      const mockEvent = {
        ...e,
        ctrlKey: true,
        stopPropagation: () => e.stopPropagation(),
        preventDefault: () => e.preventDefault(),
      } as unknown as React.MouseEvent;

      props.onSelect(props.item, mockEvent);

      // Optional: Vibration
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(50);
      }
    }
  };

  const longPressProps = useLongPress(onLongPress);

  // Combine DnD props with Long Press props
  // We need to be careful not to override DnD listeners if they overlap.
  // DnD uses Pointer events usually. useSortable gives listeners.
  // We might need to merge them.
  // Actually, useSortable listeners (onPointerDown) handle dragging.
  // Long press should strictly trigger IF drag hasn't started?
  // Or maybe we treat long press as the drag initiator?
  // Wait, if we long press -> select. If we drag -> move.
  // They can conflict.
  // Dnd-kit usually handles delay or activation constraint.
  // For selection, if we long press and hold, we select.
  // If we start moving immediately, it's a drag (handled by sensors).

  const mergedHandleProps = {
    ...handleProps,
    // We attach long press handlers to the container,
    // but DnD `listeners` are usually attached to the drag handle.
    // Here we pass `dragHandleProps` to the row/card root.
    // Let's merge properly.
    ...longPressProps,
    // If listeners has onKeyDown etc, they are preserved.
    // If listeners has onPointerDown (which it does), we need to ensure functionality.
    // onPointerDown vs onTouchStart/onMouseDown:
    // React events bubble.
    // We probably want long press specifically for logic, independent of DnD activation.
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

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
} from "lucide-react";
import { formatBytes, formatDate } from "@/lib/utils";
import { forwardRef } from "react";

interface ObjectData {
  _id: string;
  key: string;
  size: number;
  contentType: string;
  createdAt: string;
  tags?: string[];
  position?: number;
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
    },
    ref,
  ) => {
    const isFolder =
      item.contentType === "application/x-directory" || item.key.endsWith("/");

    // Virtual folder fallback name
    let name = item.key;
    if (item._id.startsWith("virtual-")) {
      name = item._id.replace("virtual-", "");
    } else {
      name =
        item.key
          .slice(currentPrefix.length)
          .replace(/\/$/, "")
          .split("/")
          .pop() || item.key;
    }

    const DefaultActions = () => (
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
        {!item._id.startsWith("virtual-") && (
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
      <TableRow
        ref={ref}
        style={style}
        {...dragHandleProps}
        className={`border-white/5 hover:bg-white/5 cursor-pointer group select-none relative ${isOverlay ? "bg-[#1a2e1d] opacity-90 shadow-xl flex items-center w-full" : ""}`}
        onClick={(e) => {
          if (isFolder && onNavigate) {
            onNavigate(name);
          } else if (!isFolder && onPreview) {
            onPreview(item);
          }
        }}
      >
        <TableCell className="w-[50%]">
          <div className="flex items-center gap-3 text-[#e8e4d9] font-medium">
            {isFolder ? (
              <Folder className="w-5 h-5 text-[#7cb686] fill-[#7cb686]/20" />
            ) : (
              <FileText className="w-4 h-4 text-[#e8e4d9]/30" />
            )}
            <span className="truncate max-w-[300px]">{name}</span>
            {item.tags && item.tags.length > 0 && (
              <div className="flex gap-1">
                {item.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="text-[10px] h-4 px-1 border-[#7cb686]/30 text-[#7cb686]"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </TableCell>
        <TableCell className="text-[#e8e4d9]/40 w-[15%]">
          {isFolder ? "-" : formatBytes(item.size)}
        </TableCell>
        <TableCell className="text-[#e8e4d9]/40 w-[15%]">
          {isFolder ? (
            "Folder"
          ) : (
            <Badge
              variant="secondary"
              className="bg-white/5 text-[#e8e4d9]/50 border-0 text-xs"
            >
              {item.contentType.split("/").pop()}
            </Badge>
          )}
        </TableCell>
        <TableCell className="text-[#e8e4d9]/40 text-sm w-[20%]">
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
                <FileText className="w-4 h-4 text-[#e8e4d9]/40 hover:text-[#7cb686]" />
              </Button>
            )}
            {!item._id.startsWith("virtual-") && (
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onTag?.(item);
                }}
              >
                <Tag className="w-4 h-4 text-[#e8e4d9]/40 hover:text-[#7cb686]" />
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>
    );

    if (isOverlay) {
      // Render simplified row for overlay (since TableRow needs Table)
      return (
        <div className="flex items-center bg-[#1a2e1d] border border-white/10 p-2 rounded-lg shadow-xl w-[600px]">
          <div className="flex items-center gap-3 text-[#e8e4d9] font-medium flex-1">
            {isFolder ? (
              <Folder className="w-5 h-5 text-[#7cb686] fill-[#7cb686]/20" />
            ) : (
              <FileText className="w-4 h-4 text-[#e8e4d9]/30" />
            )}
            <span>{name}</span>
          </div>
        </div>
      );
    }

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
        <ContextMenuContent className="w-64 bg-[#1a2e1d] border-white/10 text-[#e8e4d9]">
          {isFolder ? (
            <ContextMenuItem
              className="hover:bg-white/10 cursor-pointer"
              onClick={() => onNavigate?.(name)}
            >
              <Folder className="w-4 h-4 mr-2" /> Open
            </ContextMenuItem>
          ) : (
            <>
              <ContextMenuItem
                className="hover:bg-white/10 cursor-pointer"
                onClick={() => onPreview?.(item)}
              >
                <FileText className="w-4 h-4 mr-2" /> Preview
              </ContextMenuItem>
              <ContextMenuItem
                className="hover:bg-white/10 cursor-pointer"
                onClick={() => onDownload?.(item)}
              >
                <DownloadCloud className="w-4 h-4 mr-2" /> Download
              </ContextMenuItem>
            </>
          )}
          <DefaultActions />
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
    },
    ref,
  ) => {
    const isFolder =
      item.contentType === "application/x-directory" || item.key.endsWith("/");

    let name = item.key;
    if (item._id.startsWith("virtual-")) {
      name = item._id.replace("virtual-", "");
    } else {
      name =
        item.key
          .slice(currentPrefix.length)
          .replace(/\/$/, "")
          .split("/")
          .pop() || item.key;
    }

    const DefaultActions = () => (
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
        {!item._id.startsWith("virtual-") && (
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
          if (isFolder && onNavigate) {
            onNavigate(name);
          } else if (!isFolder && onPreview) {
            onPreview(item);
          }
        }}
        className={`aspect-square bg-[#1a2e1d] rounded-xl border border-white/5 flex flex-col items-center justify-center cursor-pointer hover:bg-[#1a2e1d]/80 transition-all hover:scale-[1.02] p-4 group relative select-none ${isOverlay ? "opacity-90 shadow-xl scale-105" : ""}`}
      >
        {/* Content */}
        {isFolder ? (
          <>
            <Folder className="w-12 h-12 text-[#7cb686] mb-3 fill-[#7cb686]/20 transition-transform group-hover:scale-110" />
            <span className="text-[#e8e4d9] font-medium text-sm text-center truncate w-full px-2">
              {name}
            </span>
            <span className="text-[#e8e4d9]/40 text-xs mt-1">Folder</span>
          </>
        ) : (
          <>
            <div className="flex-1 flex items-center justify-center w-full p-4 pb-0">
              {item.contentType.startsWith("image/") ||
              item.contentType.startsWith("video/") ? (
                <div className="relative w-full h-full flex items-center justify-center">
                  <FileText className="w-10 h-10 text-[#7cb686]" />
                </div>
              ) : (
                <FileText className="w-10 h-10 text-[#e8e4d9]/20 group-hover:text-[#7cb686] transition-colors" />
              )}
            </div>
            <div className="w-full flex flex-col items-center gap-0.5 mt-2">
              <span className="text-[#e8e4d9] font-medium text-sm text-center truncate w-full px-2">
                {name}
              </span>
              <span className="text-[#e8e4d9]/40 text-xs mt-1">
                {formatBytes(item.size)}
              </span>
            </div>
          </>
        )}

        {/* Tags Indicator */}
        {item.tags && item.tags.length > 0 && (
          <div
            className={`flex gap-1 mt-2 flex-wrap justify-center ${isFolder ? "" : "absolute top-2 left-2"}`}
          >
            {item.tags.slice(0, 3).map((tag) => (
              <div
                key={tag}
                className="w-1.5 h-1.5 rounded-full bg-[#7cb686]"
                title={tag}
              />
            ))}
          </div>
        )}

        {/* Action Overlay (Hover) */}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-md bg-black/50 hover:bg-[#7cb686] hover:text-[#0f1a12] text-[#e8e4d9] backdrop-blur-sm"
            onClick={(e) => {
              e.stopPropagation();
              onCut?.(item);
            }}
          >
            <Scissors className="w-3.5 h-3.5" />
          </Button>

          {!item._id.startsWith("virtual-") && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-md bg-black/50 hover:bg-[#7cb686] hover:text-[#0f1a12] text-[#e8e4d9] backdrop-blur-sm"
              onClick={(e) => {
                e.stopPropagation();
                onTag?.(item);
              }}
            >
              <Tag className="w-3.5 h-3.5" />
            </Button>
          )}

          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-md bg-black/50 hover:bg-red-400 hover:text-white text-[#e8e4d9] backdrop-blur-sm"
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
        <ContextMenuContent className="w-64 bg-[#1a2e1d] border-white/10 text-[#e8e4d9]">
          {isFolder ? (
            <ContextMenuItem
              className="hover:bg-white/10 cursor-pointer"
              onClick={() => onNavigate?.(name)}
            >
              <Folder className="w-4 h-4 mr-2" /> Open
            </ContextMenuItem>
          ) : (
            <>
              <ContextMenuItem
                className="hover:bg-white/10 cursor-pointer"
                onClick={() => onPreview?.(item)}
              >
                <FileText className="w-4 h-4 mr-2" /> Preview
              </ContextMenuItem>
              <ContextMenuItem
                className="hover:bg-white/10 cursor-pointer"
                onClick={() => onDownload?.(item)}
              >
                <DownloadCloud className="w-4 h-4 mr-2" /> Download
              </ContextMenuItem>
            </>
          )}
          <DefaultActions />
        </ContextMenuContent>
      </ContextMenu>
    );
  },
);
FileCard.displayName = "FileCard";

export function FileItem(props: ItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props.item._id,
    data: props.item,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.3 : 1,
  };

  const handleProps = { ...attributes, ...listeners };

  if (props.viewMode === "list") {
    // Pass handleProps to Row
    return (
      <FileRow
        ref={setNodeRef}
        style={style}
        dragHandleProps={handleProps}
        {...props}
      />
    );
  }

  return (
    <FileCard
      ref={setNodeRef}
      style={style}
      dragHandleProps={handleProps}
      {...props}
    />
  );
}

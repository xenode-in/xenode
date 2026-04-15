import React from "react";
import {
  Folder,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  File as FileGeneric,
  Presentation,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * getFileIcon helper
 * Returns a themed Lucide icon based on the MIME type or mediaCategory.
 */
export const getFileIcon = (
  contentType: string | undefined,
  className?: string,
  mediaCategory?: string,
) => {
  const type = contentType?.toLowerCase() || "";
  const category = mediaCategory?.toLowerCase() || "";

  // Helper for actual icon selection logic
  const getCategorizedIcon = (t: string, c: string) => {
    // 1. Folders
    if (t === "application/x-directory")
      return { icon: Folder, color: "text-primary fill-primary/10" };

    // 2. Images
    if (c === "image" || t.startsWith("image/"))
      return { icon: ImageIcon, color: "text-blue-500/70" };

    // 3. Videos
    if (c === "video" || t.startsWith("video/"))
      return { icon: Video, color: "text-purple-500/70" };

    // 4. Audio
    if (c === "audio" || t.startsWith("audio/"))
      return { icon: Music, color: "text-emerald-500/70" };

    // 5. Documents
    if (c === "pdf" || c === "document" || t.includes("pdf"))
      return { icon: FileText, color: "text-red-500/70" };

    if (
      c === "word" ||
      t.includes("word") ||
      t.includes("officedocument.wordprocessingml") ||
      t.includes("msword")
    )
      return { icon: FileText, color: "text-blue-600/70" };

    if (
      c === "excel" ||
      t.includes("spreadsheet") ||
      t.includes("excel") ||
      t.includes("csv") ||
      t.includes("officedocument.spreadsheetml")
    )
      return { icon: FileSpreadsheet, color: "text-emerald-600/70" };

    if (
      c === "powerpoint" ||
      t.includes("presentation") ||
      t.includes("powerpoint") ||
      t.includes("officedocument.presentationml")
    )
      return { icon: Presentation, color: "text-orange-600/70" };

    // 6. Archives
    if (
      c === "archive" ||
      t.includes("zip") ||
      t.includes("tar") ||
      t.includes("rar") ||
      t.includes("7z") ||
      t.includes("archive")
    )
      return { icon: FileArchive, color: "text-amber-500/70" };

    // 7. Code
    if (
      c === "code" ||
      t.includes("javascript") ||
      t.includes("typescript") ||
      t.includes("json") ||
      t.includes("html") ||
      t.includes("css") ||
      t.includes("xml") ||
      t.includes("markdown")
    )
      return { icon: FileCode, color: "text-sky-500/70" };

    // 8. Plain Text
    if (t.startsWith("text/"))
      return { icon: FileText, color: "text-muted-foreground/40" };

    // Default
    return { icon: FileGeneric, color: "text-muted-foreground/40" };
  };

  const { icon: Icon, color } = getCategorizedIcon(type, category);
  return <Icon className={cn(color, className)} />;
};

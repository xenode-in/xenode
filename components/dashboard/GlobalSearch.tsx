"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Lock, Folder } from "lucide-react";
import { getFileIcon } from "@/lib/file-icons";
import { searchIndex, LocalFile } from "@/lib/db/local";
import { useSyncManager } from "@/hooks/useSyncManager";
import { usePreview } from "@/contexts/PreviewContext";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import Link from "next/link";
import { formatBytes } from "@/lib/utils";

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LocalFile[]>([]);
  const [open, setOpen] = useState(false);

  // Initialize sync
  const { isSyncing } = useSyncManager();
  const { openPreview } = usePreview();

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }

    // Search via MiniSearch
    const searchResults = searchIndex.search(query, {
      prefix: true,
      fuzzy: 0.2,
      boost: { name: 2 },
    });

    setResults(searchResults.slice(0, 10) as unknown as LocalFile[]); // Top 10 results
    setOpen(true);
  }, [query]);

  const getResultUrl = (result: LocalFile) => {
    if (result.contentType === "application/x-directory") {
      const parts = result.key.split("/");
      // e.g. ["users", "userid", "my-folder", ""]
      if (parts.length > 2) {
        // join everything after users/userid/
        const relativePath = parts.slice(2).join("/");
        return `/dashboard/files?folder=${encodeURIComponent(relativePath)}`;
      }
      return "/dashboard/files";
    }
    return `/dashboard/files?fileId=${result.id}`;
  };

  return (
    <div className="relative w-full max-w-md sm:ml-4">
      <Popover open={open && results.length > 0} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={
                isSyncing ? "Syncing index..." : "Search files securely..."
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 bg-accent/50 border-none focus-visible:ring-1 w-full"
            />
          </div>
        </PopoverTrigger>
        <PopoverContent
          className="w-[calc(100vw-2rem)] sm:w-[400px] p-0"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="max-h-[300px] overflow-y-auto p-1">
            {results.map((result: LocalFile) => {
              const isFolder = result.contentType === "application/x-directory";

              const handleClick = (e: React.MouseEvent) => {
                if (isFolder) return; // let Link handle folder navigation
                e.preventDefault();
                setOpen(false);

                const fileResults = results
                  .filter((r) => r.contentType !== "application/x-directory")
                  .map((r) => ({
                    id: r.id,
                    key: r.key,
                    size: r.size,
                    contentType: r.contentType,
                    createdAt: r.createdAt,
                    isEncrypted: r.isEncrypted,
                    encryptedName: r.encryptedName ?? undefined,
                    name: r.name,
                  }));

                openPreview(
                  {
                    id: result.id,
                    key: result.key,
                    size: result.size,
                    contentType: result.contentType,
                    createdAt: result.createdAt,
                    isEncrypted: result.isEncrypted,
                    encryptedName: result.encryptedName ?? undefined,
                    name: result.name,
                  },
                  fileResults,
                );
              };

              return (
                <Link
                  key={result.id}
                  href={getResultUrl(result)}
                  onClick={handleClick}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-accent transition-colors"
                >
                  <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
                    {getFileIcon(
                      result.contentType,
                      "w-4 h-4",
                      result.mediaCategory,
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        {result.name}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {result.contentType === "application/x-directory"
                        ? "Folder"
                        : formatBytes(result.size || 0)}{" "}
                      • {new Date(result.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

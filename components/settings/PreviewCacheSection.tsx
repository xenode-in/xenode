"use client";
import { useEffect, useState } from "react";
import { HardDrive, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getCacheStats,
  clearPreviewCache,
  MAX_CACHE_BYTES,
  type CacheStats,
} from "@/lib/cache/previewCache";

function formatBytes(bytes: number): string {
  if (!bytes || isNaN(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function PreviewCacheSection() {
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  async function refresh() {
    setStats(await getCacheStats());
  }

  useEffect(() => {
    setMounted(true);
    refresh();
  }, []);

  if (!mounted) {
    return (
      <div className="flex items-center justify-between py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm text-foreground">Preview Cache</p>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Calculating…</p>
        </div>
        <Button variant="outline" size="sm" className="ml-4 shrink-0" disabled>
          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
          Clear
        </Button>
      </div>
    );
  }

  async function handleClear() {
    setClearing(true);
    await clearPreviewCache();
    await refresh();
    setClearing(false);
    setCleared(true);
    setTimeout(() => setCleared(false), 3000);
  }

  const isEmpty = stats?.count === 0;

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm text-foreground">Preview Cache</p>
          {cleared && (
            <span className="text-xs text-green-500 font-medium">
              Cleared ✓
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {stats === null ? (
            "Calculating…"
          ) : isEmpty ? (
            "No files cached"
          ) : (
            <>
              {stats.count} file{stats.count !== 1 ? "s" : ""} ·{" "}
              <span className="font-medium">
                {formatBytes(stats.totalBytes)}
              </span>{" "}
              used
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground/60 mt-0.5">
          Files under {formatBytes(MAX_CACHE_BYTES)} are cached for 24h to speed
          up repeated previews. Encrypted — safe to clear anytime.
        </p>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="ml-4 shrink-0 text-destructive border-destructive/30 hover:bg-destructive/10"
        onClick={handleClear}
        disabled={clearing || isEmpty}
      >
        {clearing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
        )}
        {clearing ? "Clearing…" : "Clear"}
      </Button>
    </div>
  );
}

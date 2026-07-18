"use client";
import { useEffect, useState } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getCacheStats,
  clearAllCaches,
  type CacheStats,
} from "@/lib/cache";

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
    const timer = setTimeout(() => {
      setMounted(true);
      refresh();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  if (!mounted) {
    return (
      <div className="flex items-center justify-between py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm text-foreground">Cache Storage</p>
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
    await clearAllCaches();
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
          <p className="text-sm text-foreground">Cache Storage</p>
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
              {stats.count} entr{stats.count !== 1 ? "ies" : "y"} ·{" "}
              <span className="font-medium">
                {formatBytes(stats.totalBytes)}
              </span>{" "}
              used
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground/60 mt-0.5">
          Previews (24h) and download chunks (7d) are cached locally.
          Encrypted — safe to clear anytime.
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

"use client";

import { AlertCircle, Check, Loader2, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

export type SaveState = "idle" | "saving" | "saved" | "error";

interface SaveStatusProps {
  status: SaveState;
  /** Epoch ms of the last successful save, or null. */
  lastSavedAt: number | null;
  /** Invoked when the user clicks "Retry" in the error state. */
  onRetry?: () => void;
}

const pill =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm select-none";

/**
 * Minimal pill badge that reflects the document's save state.
 *  - idle  → hidden
 *  - saving → spinner
 *  - saved  → checkmark + timestamp
 *  - error  → red, with a Retry button
 */
export function SaveStatus({ status, lastSavedAt, onRetry }: SaveStatusProps) {
  if (status === "idle") return null;

  if (status === "saving") {
    return (
      <div className={cn(pill, "border-border bg-card/90 text-muted-foreground backdrop-blur")}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Saving…
      </div>
    );
  }

  if (status === "saved") {
    const time = lastSavedAt
      ? new Date(lastSavedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
    return (
      <div
        className={cn(
          pill,
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        )}
      >
        <Check className="h-3.5 w-3.5" />
        Encrypted &amp; saved{time ? ` · ${time}` : ""}
      </div>
    );
  }

  // error
  return (
    <div className={cn(pill, "border-destructive/40 bg-destructive/10 text-destructive")}>
      <AlertCircle className="h-3.5 w-3.5" />
      Save failed
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="ml-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold underline-offset-2 transition-colors hover:bg-destructive/10 hover:underline"
        >
          <RotateCw className="h-3 w-3" />
          Retry
        </button>
      )}
    </div>
  );
}

"use client";

import {
  Download,
  FileWarning,
  FileX2,
  PlugZap,
  RotateCw,
  ShieldAlert,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { EditorError, EditorErrorKind } from "./types";

/**
 * Full-surface error overlay shown when the document can't be opened. Each
 * {@link EditorErrorKind} maps to the recovery that actually helps:
 *   - engine      → assets aren't vendored; offer the decrypted download.
 *   - decrypt     → wrong key / corrupt; NO partial content, just retry/close.
 *   - parse       → engine choked on a valid blob; offer the decrypted download.
 *   - unsupported → not an editable type; offer the download if we have bytes.
 *   - generic     → unknown; retry + whatever's available.
 *
 * `onDownloadDecrypted` is only wired up by the shell when decrypted bytes are
 * in hand, so guarding on its presence is enough — we never fabricate a download.
 */

interface KindConfig {
  icon: LucideIcon;
  title: string;
  description: string;
  showRetry: boolean;
}

const CONFIG: Record<EditorErrorKind, KindConfig> = {
  engine: {
    icon: PlugZap,
    title: "Editor engine unavailable",
    description:
      "The document engine couldn't be loaded. You can still download the decrypted file and open it locally.",
    showRetry: true,
  },
  decrypt: {
    icon: ShieldAlert,
    title: "Couldn't decrypt this document",
    description:
      "The file couldn't be unlocked with your vault key. It may be corrupted, or encrypted with a different key. No partial content is shown.",
    showRetry: true,
  },
  parse: {
    icon: FileWarning,
    title: "Couldn't open this document",
    description:
      "The file decrypted fine but the editor couldn't render it. You can download the decrypted copy and open it in another app.",
    showRetry: true,
  },
  unsupported: {
    icon: FileX2,
    title: "This file can't be edited here",
    description:
      "This file type isn't supported by the document editor. You can download the decrypted copy instead.",
    showRetry: false,
  },
  generic: {
    icon: TriangleAlert,
    title: "Something went wrong",
    description: "The document couldn't be opened. Try again, or close the editor.",
    showRetry: true,
  },
};

export function EditorErrorState({
  error,
  onRetry,
  onClose,
  onDownloadDecrypted,
}: {
  error: EditorError;
  onRetry: () => void;
  onClose: () => void;
  onDownloadDecrypted?: () => void;
}) {
  const { icon: Icon, title, description, showRetry } = CONFIG[error.kind];

  return (
    <div className="absolute inset-0 grid place-items-center bg-background p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-border bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          {error.message && (
            <p className="mt-2 text-xs text-muted-foreground/70">
              {error.message}
            </p>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {onDownloadDecrypted && (
            <Button onClick={onDownloadDecrypted}>
              <Download className="h-4 w-4" />
              Download decrypted copy
            </Button>
          )}
          {showRetry && (
            <Button
              variant={onDownloadDecrypted ? "outline" : "default"}
              onClick={onRetry}
            >
              <RotateCw className="h-4 w-4" />
              Try again
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

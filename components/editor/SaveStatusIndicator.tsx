"use client";

import {
  Loader2,
  ShieldCheck,
  CircleAlert,
  GitCompareArrows,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { SaveStatus } from "./types";

/**
 * Floating pill that maps the auto-save state machine to a calm, plain-language
 * status. It is the only place the encryption story surfaces in the chrome —
 * "Saved & encrypted" reassures the user their bytes were sealed before upload.
 */

interface StatusConfig {
  label: string;
  icon: LucideIcon;
  spin?: boolean;
  /** Tailwind color classes for the icon. */
  tone: string;
  /** Retry affordance — only for the recoverable states. */
  action?: string;
}

const CONFIG: Partial<Record<SaveStatus, StatusConfig>> = {
  dirty: {
    label: "Unsaved changes",
    icon: CircleAlert,
    tone: "text-muted-foreground",
  },
  saving: {
    label: "Encrypting…",
    icon: Loader2,
    spin: true,
    tone: "text-muted-foreground",
  },
  saved: {
    label: "Saved & encrypted",
    icon: ShieldCheck,
    tone: "text-emerald-600 dark:text-emerald-400",
  },
  error: {
    label: "Save failed — retrying",
    icon: CircleAlert,
    tone: "text-destructive",
    action: "Retry",
  },
  conflict: {
    label: "Changed elsewhere",
    icon: GitCompareArrows,
    tone: "text-amber-600 dark:text-amber-400",
    action: "Save anyway",
  },
};

export function SaveStatusIndicator({
  status,
  onRetry,
  className,
}: {
  status: SaveStatus;
  onRetry?: () => void;
  className?: string;
}) {
  const config = CONFIG[status];
  // "idle" (and any unmapped state) shows nothing — no chrome when there's
  // nothing to say.
  if (!config) return null;

  const { label, icon: Icon, spin, tone, action } = config;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2 rounded-full border border-border bg-background/90 py-1.5 pl-3 pr-3 text-xs font-medium text-foreground shadow-sm backdrop-blur",
        action && onRetry && "pr-1.5",
        className,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", tone, spin && "animate-spin")} />
      <span>{label}</span>
      {action && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-accent"
        >
          {action}
        </button>
      )}
    </div>
  );
}

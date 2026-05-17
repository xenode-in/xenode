"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Loader2, PauseCircle, PlayCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

interface Props {
  status: string;
  subscriptionId: string;
  cancelAtPeriodEnd: boolean;
  nextChargeAt: string | null;
  amount: number;
  planLabel: string;
}

/**
 * SubscriptionManageCard
 *
 * User-facing pause / resume / cancel controls. Delegates to the same
 * idempotent API routes the SubscribeButton flow uses. After every action
 * we refresh the page so the parent server component re-fetches subscription
 * state.
 */
export default function SubscriptionManageCard({
  status,
  cancelAtPeriodEnd,
  nextChargeAt,
  amount,
  planLabel,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function call(path: string, label: string) {
    setBusy(label);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${label} failed`);
      toast.success(`${label} successful`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  const isActive = status === "active";
  const isPaused = status === "paused";
  const isCancelled = status === "cancelled" || status === "expired";

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">
          Manage Subscription
        </h3>
        <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium capitalize text-muted-foreground">
          {status}
        </span>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Plan</span>
          <span className="text-foreground">{planLabel}</span>
        </div>
        {nextChargeAt && !isCancelled && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {cancelAtPeriodEnd ? "Access until" : "Next charge"}
            </span>
            <span className="text-foreground">
              {new Date(nextChargeAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
              {!cancelAtPeriodEnd && (
                <span className="ml-2 text-muted-foreground">
                  · ₹{amount.toFixed(2)}
                </span>
              )}
            </span>
          </div>
        )}
        {cancelAtPeriodEnd && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            Cancellation scheduled — your plan stays active until the end of the
            current period.
          </p>
        )}
      </div>

      {!isCancelled && (
        <div className="mt-5 flex flex-wrap gap-2">
          {isActive && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => call("/api/subscriptions/pause", "Pause")}
              disabled={busy !== null}
            >
              {busy === "Pause" ? (
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              ) : (
                <PauseCircle className="mr-2 h-3 w-3" />
              )}
              Pause
            </Button>
          )}
          {isPaused && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => call("/api/subscriptions/resume", "Resume")}
              disabled={busy !== null}
            >
              {busy === "Resume" ? (
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              ) : (
                <PlayCircle className="mr-2 h-3 w-3" />
              )}
              Resume
            </Button>
          )}

          {!cancelAtPeriodEnd && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" disabled={busy !== null}>
                  <XCircle className="mr-2 h-3 w-3" />
                  Cancel
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your subscription will remain active until{" "}
                    {nextChargeAt
                      ? new Date(nextChargeAt).toLocaleDateString()
                      : "the end of the current period"}
                    , then automatically downgrade to the Free tier. You can
                    resume anytime before then.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep subscription</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      call("/api/subscriptions/cancel", "Cancellation")
                    }
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Confirm cancel
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}
    </div>
  );
}

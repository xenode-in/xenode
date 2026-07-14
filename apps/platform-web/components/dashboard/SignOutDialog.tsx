"use client";

/**
 * SignOutDialog
 *
 * Replaces the direct signOut() call with a confirmation dialog.
 *
 * The checkbox lets users decide whether to wipe the cached vault keys
 * from IndexedDB on this device:
 *
 *   Unchecked (default) — keys stay in IDB, vault auto-unlocks next sign-in.
 *                          Best for personal devices.
 *
 *   Checked             — IDB cleared, user must re-enter master password
 *                          on next sign-in. Best for shared/public devices.
 */

import React, { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { LogOut, ShieldAlert } from "lucide-react";
import { signOut } from "@/lib/auth/client";
import { clearCachedKeys } from "@/lib/crypto/keyCache";
import { useCrypto } from "@/contexts/CryptoContext";
import { useRouter } from "next/navigation";

interface SignOutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const router = useRouter();
  const { lock, logout } = useCrypto();
  const [clearKeys, setClearKeys] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    try {
      // Always log out (clears IDB if userId is present)
      await logout();

      // Optionally wipe IDB cache too (redundant now if logout handles it, but kept for cache explicit clear)
      if (clearKeys) {
        await clearCachedKeys();
      }

      await signOut();
      router.push("/login");
    } catch {
      // Sign out anyway even if cleanup fails
      await signOut();
      router.push("/login");
    } finally {
      setLoading(false);
      onOpenChange(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <LogOut className="h-5 w-5 text-destructive" />
            </div>
            <AlertDialogTitle className="text-lg">Sign out of Xenode?</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-sm text-muted-foreground">
            You’ll need to sign back in to access your files.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Clear keys option */}
        <div
          className={`flex items-start gap-3 rounded-lg border-2 p-4 cursor-pointer transition-colors ${
            clearKeys
              ? "border-destructive/40 bg-destructive/5"
              : "border-border bg-muted/30 hover:bg-muted/50"
          }`}
          onClick={() => setClearKeys(v => !v)}
        >
          <Checkbox
            id="clear-keys"
            checked={clearKeys}
            onCheckedChange={(checked) => setClearKeys(!!checked)}
            className="mt-0.5 shrink-0"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="space-y-1">
            <Label
              htmlFor="clear-keys"
              className="text-sm font-medium cursor-pointer leading-snug"
            >
              Also clear saved vault keys from this device
            </Label>
            <p className="text-xs text-muted-foreground leading-snug">
              Tick this on shared or public computers. You’ll need to re-enter
              your master password when you sign back in.
            </p>
          </div>
        </div>

        {clearKeys && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Vault keys will be removed from this device. Your files are safe —
              just unlock with your master password next time.
            </p>
          </div>
        )}

        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleSignOut}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? "Signing out..." : "Sign Out"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

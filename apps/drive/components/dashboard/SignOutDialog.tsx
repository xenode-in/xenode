"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCrypto } from "@/contexts/CryptoContext";
import { signOut } from "@/lib/auth/client";

interface SignOutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SignOutDialog({
  open,
  onOpenChange,
}: SignOutDialogProps) {
  const { logout } = useCrypto();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    const accountsOrigin = new URL(
      process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN ??
        "https://accounts.xenode.in",
    ).origin;
    let logoutUrl = `${accountsOrigin}/logout`;
    try {
      await logout();
      const result = await signOut();
      logoutUrl = result.logoutUrl ?? logoutUrl;
    } catch {
      const result = await signOut().catch(() => null);
      logoutUrl = result?.logoutUrl ?? logoutUrl;
    } finally {
      onOpenChange(false);
      window.location.assign(logoutUrl);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <div className="mb-1 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <LogOut className="h-5 w-5 text-destructive" />
            </div>
            <AlertDialogTitle className="text-lg">
              Sign out of Xenode?
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-sm text-muted-foreground">
            You’ll need to sign back in to access your files and photos.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <p className="rounded-lg border border-border bg-muted/30 p-4 text-xs leading-5 text-muted-foreground">
          This signs you out of Drive, Photos, and Xenode Accounts in this
          browser. Other devices stay signed in.
        </p>

        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleSignOut}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? "Signing out…" : "Sign out"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

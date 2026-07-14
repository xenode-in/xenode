"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { authClient } from "@/lib/auth/client";

import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";

export function ConnectedAccounts() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    const error = searchParams.get("error");
    if (error) {
      if (
        error === "email_doesn't_match" ||
        error === "account_already_linked_to_different_user" ||
        error === "signup_disabled" ||
        error === "signup disabled"
      ) {
        toast.error("Cannot link account", {
          description: "The Google account email must exactly match your Xenode login email.",
          duration: 5000,
        });
      } else {
        toast.error("Failed to link account", {
          description: "Something went wrong while connecting your Google account.",
          duration: 5000,
        });
      }
      // Clean up the URL to remove the error param
      router.replace("/dashboard/settings");
    }
  }, [searchParams, router]);

  const fetchAccounts = async () => {
    try {
      const res = await fetch("/api/auth/accounts");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnectGoogle = async () => {
    await authClient.linkSocial({
      provider: "google",
      callbackURL: "/dashboard/settings",
      errorCallbackURL: "/dashboard/settings"
    });
  };

  const hasGoogleAccount = accounts.some(acc => acc.providerId === "google");

  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="text-sm text-foreground">Connected Accounts</p>
        <p className="text-xs text-muted-foreground mt-0.5">Manage linked OAuth providers</p>
      </div>
      
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : hasGoogleAccount ? (
        <span className="text-xs text-emerald-500 bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/20">
          Google Connected
        </span>
      ) : (
        <Button variant="outline" size="sm" onClick={handleConnectGoogle}>
          Connect Google
        </Button>
      )}
    </div>
  );
}

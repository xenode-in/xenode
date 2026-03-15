"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { authClient } from "@/lib/auth/client";

export function ConnectedAccounts() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchAccounts();
  }, []);

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
    await authClient.signIn.social({
      provider: "google",
      callbackURL: "/dashboard/settings"
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

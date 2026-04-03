"use client";
import { useState, useEffect, useCallback } from "react";
import { useCrypto } from "@/contexts/CryptoContext";
import { registerPasskeyWithPRF } from "@/lib/passkey-prf";
import { isPlatformAuthenticatorAvailable } from "@/lib/passkey-support";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Fingerprint, Trash2, Plus, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function PasskeySettingsSection() {
  const { isUnlocked, privateKeyBuf } = useCrypto();
  const [show, setShow] = useState<boolean | null>(null);
  const [passkeys, setPasskeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchPasskeys = useCallback(async () => {
    try {
      const res = await fetch("/api/passkey");
      if (res.ok) {
        setPasskeys(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch passkeys:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (localStorage.getItem("xenode_prf_unsupported")) {
      setShow(false);
      return;
    }
    isPlatformAuthenticatorAvailable().then(setShow);
    fetchPasskeys();
  }, [fetchPasskeys]);

  async function handleRegister() {
    if (!isUnlocked || !privateKeyBuf) {
      toast.error("Something went wrong. Please try again.");
      return;
    }

    setRegistering(true);
    try {
      const result = await registerPasskeyWithPRF(privateKeyBuf);
      if (result.ok) {
        toast.success("Passkey registered successfully!");
        fetchPasskeys();
      } else if (result.prfUnsupported) {
        setShow(false);
        toast.error("This device doesn't support passwordless vault unlock");
      } else {
        toast.error("Failed to register passkey. Try again.");
      }
    } catch (err) {
      console.error("Registration error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setRegistering(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch("/api/passkey", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        toast.success("Passkey removed");
        fetchPasskeys();
      } else {
        toast.error("Failed to remove passkey");
      }
    } catch (err) {
      console.error("Delete error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setDeletingId(null);
    }
  }

  if (show === false) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Fingerprint className="w-4 h-4 text-primary" /> Passkeys
          </h3>
          <p className="text-xs text-muted-foreground">
            Sign in and unlock your vault using Face ID, Touch ID, or Windows
            Hello.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRegister}
          disabled={registering || !isUnlocked}
          className="gap-2"
        >
          {registering ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          Add passkey
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-12 w-full animate-pulse bg-muted rounded-md" />
        </div>
      ) : passkeys.length > 0 ? (
        <div className="border rounded-md overflow-hidden divide-y divide-border">
          {passkeys.map((p) => (
            <div
              key={p._id}
              className="p-3 flex items-center justify-between bg-card"
            >
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 p-2 rounded-full">
                  <Fingerprint className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{p.name || "Passkey"}</p>
                  <p className="text-[10px] text-muted-foreground">
                    Added {formatDistanceToNow(new Date(p.createdAt))} ago
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive transition-colors"
                onClick={() => handleDelete(p._id)}
                disabled={deletingId === p._id}
              >
                {deletingId === p._id ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Trash2 className="w-3 h-3" />
                )}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 border border-dashed rounded-md text-center bg-muted/30">
          <p className="text-xs text-muted-foreground">
            No passkeys registered on this account.
          </p>
        </div>
      )}

      {!isUnlocked && (
        <p className="text-[10px] text-amber-500 font-medium">
          Note: You must unlock your vault first to register a new passkey.
        </p>
      )}
    </div>
  );
}

"use client";

/**
 * AddPasskeySection
 *
 * Shown in Settings → Security when vaultType is 'passphrase'.
 * Lets the user add a passkey (PRF) on top of their existing passphrase vault.
 *
 * Flow:
 *   1. User clicks "Add Passkey"
 *   2. We ask for their current passphrase (to decrypt the private key)
 *   3. We call addPRFLayer(passphrase) from CryptoContext
 *      → addPRFLayerToVault in keySetup.ts
 *      → registers passkey with PRF
 *      → re-encrypts private key with PRF master key
 *      → PATCH /api/keys/vault/prf → vaultType: 'both'
 *   4. Card flips to green 'Passkey active' state
 *
 * Hidden when vaultType is 'prf' or 'both' (already has a passkey).
 */

import { useState } from "react";
import { Fingerprint, Eye, EyeOff, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCrypto } from "@/contexts/CryptoContext";
import { authClient } from "@/lib/auth/client";
import { toast } from "sonner";

export function AddPasskeySection() {
  const { vaultType, addPRFLayer, isInitializing } = useCrypto();

  const [expanded, setExpanded] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [loading, setLoading] = useState(false);

  // Only show this section if:
  // - vault exists and is passphrase-only
  // (hidden for prf-only, both, needsSetup, or still initializing)
  if (isInitializing) return null;
  if (vaultType !== "passphrase") return null;

  const handleAddPasskey = async () => {
    if (!passphrase) {
      toast.error("Enter your current passphrase first.");
      return;
    }

    setLoading(true);
    try {
      const session = await authClient.getSession();
      const userId = session?.data?.user?.id;
      const userName =
        session?.data?.user?.email ||
        session?.data?.user?.name ||
        "user";

      if (!userId) throw new Error("Not authenticated");

      const result = await addPRFLayer(passphrase, userId, userName);

      if (!result.supported) {
        toast.error(
          "Your browser or device doesn't support passkeys with PRF. Try Chrome on Android/desktop, or Safari on iOS/macOS.",
        );
        return;
      }

      toast.success("Passkey added! You can now unlock your vault with biometrics.");
      setExpanded(false);
      setPassphrase("");
    } catch (e) {
      if (e instanceof Error) {
        if (e.message === "WRONG_PASSWORD") {
          toast.error("Wrong passphrase. Try again.");
        } else if (e.message === "Passkey registration cancelled") {
          toast.info("Passkey registration cancelled.");
        } else {
          toast.error(e.message || "Something went wrong.");
        }
      } else {
        toast.error("Something went wrong.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="py-3 border-b border-border">
      <button
        type="button"
        className="w-full flex items-center justify-between text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div>
          <p className="text-sm text-foreground flex items-center gap-1.5">
            <Fingerprint className="w-3.5 h-3.5 text-primary" />
            Add Passkey (biometric unlock)
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Use Face ID, fingerprint, or PIN to unlock your vault — no passphrase needed.
          </p>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Enter your current passphrase to verify ownership before adding a passkey.
          </p>
          <div className="relative">
            <Input
              type={showPassphrase ? "text" : "password"}
              placeholder="Current passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="pr-10"
              onKeyDown={(e) => e.key === "Enter" && handleAddPasskey()}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              onClick={() => setShowPassphrase((v) => !v)}
            >
              {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button
            type="button"
            className="w-full"
            onClick={handleAddPasskey}
            disabled={loading || !passphrase}
          >
            {loading ? "Registering passkey..." : "Register Passkey"}
            {!loading && <Fingerprint className="ml-2 h-4 w-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * PasskeyActiveSection
 * Shown when vaultType is 'prf' or 'both' — passkey is already active.
 */
export function PasskeyActiveSection() {
  const { vaultType, isInitializing } = useCrypto();

  if (isInitializing) return null;
  if (vaultType !== "prf" && vaultType !== "both") return null;

  return (
    <div className="flex items-center justify-between py-3 border-b border-border">
      <div>
        <p className="text-sm text-foreground flex items-center gap-1.5">
          <Fingerprint className="w-3.5 h-3.5 text-primary" />
          Passkey (biometric unlock)
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {vaultType === "both"
            ? "Active — vault can be unlocked with passkey or passphrase."
            : "Active — vault unlocks with your passkey biometric."}
        </p>
      </div>
      <span className="flex items-center gap-1 text-xs text-green-600 bg-green-500/10 px-3 py-1.5 rounded-lg">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Active
      </span>
    </div>
  );
}

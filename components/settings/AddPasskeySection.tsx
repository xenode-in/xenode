"use client";

/**
 * AddPasskeySection  — shown in Settings when vaultType is 'passphrase'
 * AddPassphraseSection — shown in Settings when vaultType is 'prf'
 * PasskeyActiveSection — shown when vaultType is 'prf' or 'both'
 */

import { useState } from "react";
import {
  Fingerprint,
  Eye,
  EyeOff,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCrypto } from "@/contexts/CryptoContext";
import { authClient } from "@/lib/auth/client";
import { toast } from "sonner";

// ─── Add Passkey (for passphrase-only users) ─────────────────────────────────

export function AddPasskeySection() {
  const { vaultType, addPRFLayer, isInitializing } = useCrypto();
  const [expanded, setExpanded] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [loading, setLoading] = useState(false);

  // Only show for passphrase-only vaults
  if (isInitializing || vaultType !== "passphrase") return null;

  async function handleAddPasskey() {
    if (!passphrase) {
      toast.error("Enter your current passphrase first.");
      return;
    }
    setLoading(true);
    try {
      const session = await authClient.getSession();
      const userId = session?.data?.user?.id;
      const userName = session?.data?.user?.email ?? session?.data?.user?.name ?? "user";
      if (!userId) throw new Error("Not authenticated");

      const result = await addPRFLayer(passphrase, userId, userName);
      if (!result.supported) {
        toast.error(
          "Your browser/device doesn't support passkeys with PRF. Try Chrome on desktop/Android or Safari on iOS/macOS.",
        );
        return;
      }
      toast.success("Passkey added! You can now unlock your vault with biometrics.");
      setExpanded(false);
      setPassphrase("");
    } catch (e) {
      if (e instanceof Error) {
        if (e.message === "WRONG_PASSWORD") toast.error("Wrong passphrase. Try again.");
        else if (e.message === "Passkey registration cancelled") toast.info("Passkey registration cancelled.");
        else toast.error(e.message || "Something went wrong.");
      }
    } finally {
      setLoading(false);
    }
  }

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
            Add Passkey
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Use Face ID, fingerprint, or PIN to unlock your vault without typing a passphrase.
          </p>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Your current passphrase is required to verify ownership before adding a passkey.
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
            {loading ? "Registering..." : "Register Passkey"}
            {!loading && <Fingerprint className="ml-2 h-4 w-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Add Passphrase Backup (for PRF-only users) ──────────────────────────────

export function AddPassphraseSection() {
  const { vaultType, addPassphraseLayer, unlock, isInitializing } = useCrypto();
  const [expanded, setExpanded] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [loading, setLoading] = useState(false);

  // Only show for PRF-only vaults
  if (isInitializing || vaultType !== "prf") return null;

  async function handleAddPassphrase() {
    if (passphrase.length < 8) {
      toast.error("Passphrase must be at least 8 characters.");
      return;
    }
    if (passphrase !== confirm) {
      toast.error("Passphrases do not match.");
      return;
    }
    setLoading(true);
    try {
      // addPassphraseLayer will prompt the passkey biometric to decrypt
      // the private key, then re-encrypt with the new passphrase
      await addPassphraseLayer(passphrase);
      // Unlock with the new passphrase to cache keys
      await unlock(passphrase);
      toast.success("Passphrase backup set! Your vault now supports both unlock methods.");
      setExpanded(false);
      setPassphrase("");
      setConfirm("");
    } catch (e) {
      if (e instanceof Error) {
        if (e.message === "PRF_NOT_SUPPORTED") {
          toast.error("Your passkey isn't available on this browser. Try the device where you registered it.");
        } else if (e.message === "Passkey authentication cancelled") {
          toast.info("Cancelled — your passkey is needed to set a passphrase backup.");
        } else {
          toast.error(e.message || "Something went wrong.");
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="py-3 border-b border-border">
      <button
        type="button"
        className="w-full flex items-center justify-between text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div>
          <p className="text-sm text-foreground flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-primary" />
            Add Passphrase Backup
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Set a passphrase so you can access your files if your passkey isn't available.
          </p>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Your passkey will be prompted once to verify your identity.
            </p>
          </div>
          <div className="relative">
            <Input
              type={showPassphrase ? "text" : "password"}
              placeholder="New passphrase (min 8 chars)"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="pr-10"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              onClick={() => setShowPassphrase((v) => !v)}
            >
              {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Input
            type={showPassphrase ? "text" : "password"}
            placeholder="Confirm passphrase"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <Button
            type="button"
            className="w-full"
            onClick={handleAddPassphrase}
            disabled={loading || passphrase.length < 8}
          >
            {loading ? "Setting up..." : "Set Passphrase Backup"}
            {!loading && <Lock className="ml-2 h-4 w-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Passkey Active Badge ─────────────────────────────────────────────────────

export function PasskeyActiveSection() {
  const { vaultType, isInitializing } = useCrypto();
  if (isInitializing || (vaultType !== "prf" && vaultType !== "both")) return null;

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

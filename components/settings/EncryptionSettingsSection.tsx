"use client";

import { useEffect, useState } from "react";
import { Lock, ShieldCheck, ShieldOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useCrypto } from "@/contexts/CryptoContext";

export const ENCRYPT_PREF_KEY = "xenode.encryptUploads";

export function EncryptionSettingsSection() {
  const { isUnlocked, needsSetup } = useCrypto();
  const [enabled, setEnabled] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Read preference from localStorage after mount (SSR-safe)
  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(ENCRYPT_PREF_KEY);
      setEnabled(stored === "true");
    } catch {
      // localStorage not available (private browsing edge cases)
    }
  }, []);

  function handleToggle(checked: boolean) {
    setEnabled(checked);
    try {
      localStorage.setItem(ENCRYPT_PREF_KEY, String(checked));
    } catch {
      /* ignore */
    }
  }

  const vaultReady = isUnlocked;
  const disabled = !vaultReady;

  if (!mounted) return null; // prevent hydration flash

  return (
    <div className="flex items-center justify-between py-3 border-b border-border">
      <div className="flex-1 pr-4">
        <p className="text-sm text-foreground flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-primary" />
          Encrypt uploads by default
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {needsSetup
            ? "Set up your encryption vault in the dashboard to enable this."
            : !vaultReady
              ? "Unlock your vault to enable encrypted uploads."
              : enabled
                ? "New files will be end-to-end encrypted before upload."
                : "Files will be uploaded without encryption."}
        </p>
        {vaultReady && enabled && (
          <p className="text-xs text-primary mt-1 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" />
            Active — uploads are encrypted
          </p>
        )}
        {vaultReady && !enabled && (
          <p className="text-xs text-muted-foreground/60 mt-1 flex items-center gap-1">
            <ShieldOff className="w-3 h-3" />
            Inactive — files upload as plaintext
          </p>
        )}
      </div>
      <Switch
        id="encrypt-uploads-toggle"
        checked={enabled}
        onCheckedChange={handleToggle}
        disabled={disabled}
        aria-label="Encrypt uploads by default"
      />
    </div>
  );
}

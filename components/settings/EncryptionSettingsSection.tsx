"use client";

import { useState } from "react";
import { Lock, ShieldCheck, ShieldOff, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useCrypto } from "@/contexts/CryptoContext";
import { authClient, useSession } from "@/lib/auth/client";
import { toast } from "sonner";

export function EncryptionSettingsSection() {
  const { isUnlocked, needsSetup } = useCrypto();
  const { data: session } = useSession();
  const [isUpdating, setIsUpdating] = useState(false);

  // @ts-expect-error additionalFields
  const enabled = session?.user?.encryptByDefault || false;

  async function handleToggle(checked: boolean) {
    setIsUpdating(true);
    try {
      const { error } = await authClient.updateUser({
        // @ts-expect-error additionalFields
        encryptByDefault: checked,
      });

      if (error) {
        throw new Error(error.message || "Failed to update preference");
      }

      toast.success(
        checked
          ? "Encryption enabled by default"
          : "Encryption disabled by default",
      );
    } catch (err) {
      toast.error("Failed to update settings. Please try again.");
      console.error(err);
    } finally {
      setIsUpdating(false);
    }
  }

  const vaultReady = isUnlocked;
  const disabled = !vaultReady || isUpdating;

  if (!session) return null; // prevent hydration flash or show nothing if no session

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

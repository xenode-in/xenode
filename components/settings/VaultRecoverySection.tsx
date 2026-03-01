"use client";

/**
 * VaultRecoverySection
 *
 * Shown in Settings → Security.
 * Lets the user generate a new recovery kit, which replaces the current vault.
 *
 * WARNING copy is shown before confirming — user must understand
 * old encrypted files become inaccessible.
 */

import { useState } from "react";
import { ShieldCheck, RefreshCw, AlertTriangle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCrypto } from "@/contexts/CryptoContext";
import { SetupVaultModal } from "@/components/dashboard/SetupVaultModal";

export function VaultRecoverySection() {
  const { isUnlocked, needsSetup, isInitializing, regenerate } = useCrypto();
  const [showConfirm, setShowConfirm] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [loading, setLoading] = useState(false);

  if (isInitializing) return null;

  // No vault yet — show setup prompt
  if (needsSetup) {
    return (
      <div className="flex items-center justify-between py-3 border-b border-border">
        <div>
          <p className="text-sm text-foreground flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" />
            Recovery Kit
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            No vault set up. Set up encryption to protect your files.
          </p>
        </div>
        <>
          <Button size="sm" onClick={() => setShowSetup(true)}>
            Set up
          </Button>
          <SetupVaultModal open={showSetup} onClose={() => setShowSetup(false)} />
        </>
      </div>
    );
  }

  return (
    <div className="py-3 border-b border-border">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-foreground flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
            Recovery Kit
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isUnlocked
              ? "Your vault is active. Generate a new kit if your current one is lost."
              : "Unlock your vault to manage your recovery kit."}
          </p>
        </div>
        {isUnlocked && !showConfirm && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowConfirm(true)}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Generate new kit
          </Button>
        )}
      </div>

      {/* Danger confirmation */}
      {showConfirm && (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">This will replace your current vault</p>
              <p className="text-xs text-muted-foreground">
                A new recovery kit and keypair will be generated. Any files currently
                encrypted with your old key will no longer be accessible.
                Make sure you've downloaded unencrypted copies of important files first.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={loading}
              onClick={async () => {
                // Open the full setup modal which handles word display + verification
                setShowConfirm(false);
                setShowSetup(true);
              }}
            >
              {loading ? (
                <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Generating...</>
              ) : (
                "Yes, generate new kit"
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowConfirm(false)}
              disabled={loading}
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Reuse SetupVaultModal for new kit generation */}
      <SetupVaultModal open={showSetup} onClose={() => setShowSetup(false)} />
    </div>
  );
}

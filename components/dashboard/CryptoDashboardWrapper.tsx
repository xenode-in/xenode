"use client";

import React, { useState } from "react";
import { useCrypto } from "@/contexts/CryptoContext";
import { UnlockVaultModal } from "@/components/dashboard/UnlockVaultModal";
import { SetupVaultModal } from "@/components/dashboard/SetupVaultModal";
import { ShieldAlert, X } from "lucide-react";

export function CryptoDashboardWrapper({ children }: { children: React.ReactNode }) {
  const { isInitializing, isUnlocked, needsSetup, isModalOpen, setModalOpen } = useCrypto();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [unlockDismissed, setUnlockDismissed] = useState(false);

  // Setup modal: shown when vault has never been created
  // Non-blocking — user can dismiss the banner and use the dashboard without encryption
  const showSetupBanner = !isInitializing && needsSetup && !bannerDismissed;

  // Unlock modal: shown when vault exists but keys aren't in IDB cache
  const showUnlockModal =
    !isInitializing &&
    !needsSetup &&
    !isUnlocked &&
    (isModalOpen || !unlockDismissed);

  return (
    <>
      {/* Non-blocking setup banner — only when vault has never been created */}
      {showSetupBanner && (
        <div className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 mt-0.5">
              <ShieldAlert className="h-4 w-4 text-amber-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Your files aren't protected yet
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Set up encryption to keep your files private. Takes 30 seconds.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <SetupVaultInlineButton />
            <button
              onClick={() => setBannerDismissed(true)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {children}

      {/* Unlock modal — vault exists, just needs recovery words */}
      <UnlockVaultModal
        open={showUnlockModal}
        onClose={() => {
          setModalOpen(false);
          setUnlockDismissed(true);
        }}
      />
    </>
  );
}

// Small inline button that opens the setup modal
function SetupVaultInlineButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline"
      >
        Set up now
      </button>
      <SetupVaultModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

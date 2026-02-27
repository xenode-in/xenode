"use client";

import React, { useState } from "react";
import { useCrypto } from "@/contexts/CryptoContext";
import { UnlockVaultModal } from "@/components/dashboard/UnlockVaultModal";
import { Lock, X } from "lucide-react";
import Link from "next/link";

export function CryptoDashboardWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    isInitializing,
    isUnlocked,
    needsSetup,
    vaultType,
    isModalOpen,
    setModalOpen,
  } = useCrypto();

  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [modalDismissed, setModalDismissed] = useState(false);

  // Show unlock modal when:
  // - vault exists (vaultType is known) and not yet unlocked
  // - OR explicitly opened via setModalOpen
  const showModal =
    !isInitializing &&
    !isUnlocked &&
    !needsSetup && // needsSetup uses the banner instead
    (isModalOpen || (vaultType !== null && !modalDismissed));

  // Show setup banner when vault hasn't been created yet
  const showSetupBanner =
    !isInitializing && needsSetup && !bannerDismissed;

  return (
    <>
      {/* Soft, non-blocking setup banner */}
      {showSetupBanner && (
        <div className="mx-4 mt-4 flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Lock className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Protect your files with encryption
              </p>
              <p className="text-xs text-muted-foreground">
                Set up end-to-end encryption so only you can access your files.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/dashboard/settings"
              className="text-xs font-medium text-primary hover:underline"
            >
              Set up now
            </Link>
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

      <UnlockVaultModal
        open={showModal}
        onClose={() => {
          setModalOpen(false);
          setModalDismissed(true);
        }}
      />
    </>
  );
}

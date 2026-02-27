"use client";

import React, { useState } from "react";
import { useCrypto } from "@/contexts/CryptoContext";
import { UnlockVaultModal } from "@/components/dashboard/UnlockVaultModal";

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
  const [dismissed, setDismissed] = useState(false);

  /**
   * Only show the modal when:
   * 1. Initialization (IDB cache check) is fully complete
   * 2. Keys are NOT already loaded from cache (isUnlocked = false)
   * 3. Either:
   *    a. Modal was explicitly opened (isModalOpen)
   *    b. Vault needs setup (first time, no vault on server)
   *    c. Vault exists on server (vaultType is known) but not yet unlocked
   *       AND user hasn't dismissed it this session
   */
  const vaultNeedsAction =
    needsSetup || (vaultType !== null && !isUnlocked && !dismissed);

  const showModal =
    !isInitializing && !isUnlocked && (isModalOpen || vaultNeedsAction);

  return (
    <>
      {children}
      <UnlockVaultModal
        open={showModal}
        onClose={() => {
          setModalOpen(false);
          setDismissed(true);
        }}
      />
    </>
  );
}

"use client";

import React, { useState } from "react";
import { useCrypto } from "@/contexts/CryptoContext";
import { UnlockVaultModal } from "@/components/dashboard/UnlockVaultModal";

export function CryptoDashboardWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isInitializing, isUnlocked, isModalOpen, setModalOpen } = useCrypto();
  const [dismissed, setDismissed] = useState(false);

  // Show modal if explicitly requested, OR if not-unlocked and not-dismissed yet
  // Wait until initialization check is complete to prevent a split-second flash
  const showModal =
    !isInitializing && (isModalOpen || (!isUnlocked && !dismissed));

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

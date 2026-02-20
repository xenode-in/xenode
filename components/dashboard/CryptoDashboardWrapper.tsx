"use client";

import React from "react";
import { useCrypto } from "@/contexts/CryptoContext";
import { UnlockVaultModal } from "@/components/dashboard/UnlockVaultModal";

/**
 * Client boundary that renders the UnlockVaultModal when the vault is not
 * yet unlocked. Children (the dashboard pages) render normally even before
 * unlock — they just won't be able to decrypt files until the modal is completed.
 */
export function CryptoDashboardWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isUnlocked, needsSetup } = useCrypto();

  const showModal = !isUnlocked;

  return (
    <>
      {children}
      <UnlockVaultModal open={showModal} />
    </>
  );
}

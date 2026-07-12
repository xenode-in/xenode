"use client";

import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCrypto } from "@/contexts/CryptoContext";
import { buildDek, buildShareKey } from "@/lib/crypto/directShare";
import { SpreadsheetCommentsPanel } from "@/components/sheets/SpreadsheetCommentsPanel";

/**
 * E2EE comment threads on a shared file (dashboard surface). Thin dialog host
 * around the same panel the sheets editor uses: comments are object-centric
 * and encrypted with the file DEK, derived here through the recipient's
 * share-key chain.
 */
export function FileCommentsDialog({
  objectId,
  wrappedShareKey,
  shareEncryptedDEK,
  shareKeyIv,
  canComment,
  fileName,
  open,
  onOpenChange,
}: {
  objectId: string | null;
  wrappedShareKey: string | null;
  shareEncryptedDEK: string | null;
  shareKeyIv: string | null;
  canComment: boolean;
  fileName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { privateKey, isUnlocked, setModalOpen } = useCrypto();
  const [dek, setDek] = useState<CryptoKey | null>(null);

  useEffect(() => {
    if (!open) {
      // Matches the repository client-dialog reset convention.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDek(null);
      return;
    }
    if (!isUnlocked) {
      setModalOpen(true);
      return;
    }
    if (!privateKey || !wrappedShareKey || !shareEncryptedDEK || !shareKeyIv) return;
    let active = true;
    (async () => {
      try {
        const shareKey = await buildShareKey(wrappedShareKey, privateKey);
        const fileDek = await buildDek(shareKey, shareEncryptedDEK, shareKeyIv, [
          "encrypt",
          "decrypt",
        ]);
        if (active) setDek(fileDek);
      } catch {
        if (active) setDek(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, isUnlocked, privateKey, wrappedShareKey, shareEncryptedDEK, shareKeyIv, setModalOpen]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            Comments
          </DialogTitle>
          <DialogDescription className="truncate">
            {fileName || "Shared file"} · encrypted for file participants
          </DialogDescription>
        </DialogHeader>

        {objectId && dek ? (
          <SpreadsheetCommentsPanel
            objectId={objectId}
            dek={dek}
            canComment={canComment}
            onClose={() => onOpenChange(false)}
            hideHeader
            className="flex max-h-[60vh] w-full flex-col"
          />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {isUnlocked ? "Preparing encrypted comments…" : "Unlock your vault to view comments."}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

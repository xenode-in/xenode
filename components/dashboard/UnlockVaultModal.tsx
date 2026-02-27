"use client";

/**
 * UnlockVaultModal
 *
 * Shown when vault exists on server but IDB cache is empty
 * (new device, cleared storage, or after lock).
 *
 * The user enters their 12 recovery words (space-separated).
 * We pass the joined string as the passphrase to unlockVault().
 *
 * Simple. One input. No choices.
 */

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Lock, KeyRound, Loader2 } from "lucide-react";
import { useCrypto } from "@/contexts/CryptoContext";

interface UnlockVaultModalProps {
  open: boolean;
  onClose: () => void;
}

export function UnlockVaultModal({ open, onClose }: UnlockVaultModalProps) {
  const { unlock } = useCrypto();
  const [words, setWords] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Normalise input: trim, lowercase, collapse whitespace
  function normalise(input: string) {
    return input.trim().toLowerCase().replace(/\s+/g, " ");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const passphrase = normalise(words);
    const wordCount = passphrase.split(" ").filter(Boolean).length;
    if (wordCount !== 12) {
      setError(`Enter all 12 recovery words. You've entered ${wordCount}.`);
      return;
    }

    setLoading(true);
    try {
      await unlock(passphrase);
      setWords("");
      onClose();
    } catch (err) {
      if (err instanceof Error && err.message === "WRONG_PASSWORD") {
        setError("Those words don't match your recovery kit. Check your saved copy and try again.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center text-lg">Unlock your files</DialogTitle>
          <DialogDescription className="text-center text-sm text-muted-foreground">
            Enter your 12 recovery words to decrypt your files on this device.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-2 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="recovery-words">Recovery words</Label>
            <Textarea
              id="recovery-words"
              value={words}
              onChange={(e) => setWords(e.target.value)}
              placeholder="word1 word2 word3 ... word12"
              className="min-h-[80px] resize-none font-mono text-sm lowercase"
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Paste or type all 12 words separated by spaces.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading || !words.trim()}>
            {loading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Unlocking...</>
            ) : (
              <><KeyRound className="mr-2 h-4 w-4" /> Unlock files</>
            )}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Your recovery words never leave this device.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}

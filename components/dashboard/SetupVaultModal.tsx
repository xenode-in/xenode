"use client";

/**
 * SetupVaultModal
 *
 * Shown when needsSetup = true (user has no vault yet).
 * Two steps:
 *   Step 1 — Display recovery kit (12 words)
 *             User must copy/download + check the checkbox
 *   Step 2 — Confirm 3 random words to prove they saved it
 *             Then vault is created and user is unlocked
 *
 * The 12 words ARE the passphrase. They are joined with spaces
 * and passed into setupUserKeyVault().
 */

import React, { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ShieldCheck,
  Copy,
  Download,
  CheckCircle2,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { useCrypto } from "@/contexts/CryptoContext";
import { generateRecoveryKit } from "@/lib/crypto/recovery";
import { toast } from "sonner";

interface SetupVaultModalProps {
  open: boolean;
  onClose: () => void;
}

export function SetupVaultModal({ open, onClose }: SetupVaultModalProps) {
  const { setup } = useCrypto();

  // Generate kit once when component first mounts
  const [kit] = useState(() => generateRecoveryKit());
  const [step, setStep] = useState<1 | 2>(1);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 2: verify 3 random word positions
  const [verifyIndices] = useState(() => {
    // Pick 3 unique random positions from 0-11
    const positions: number[] = [];
    while (positions.length < 3) {
      const idx = Math.floor(Math.random() * 12);
      if (!positions.includes(idx)) positions.push(idx);
    }
    return positions.sort((a, b) => a - b);
  });
  const [verifyInputs, setVerifyInputs] = useState<Record<number, string>>({});

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(kit.words.join(" "));
    toast.success("Recovery kit copied to clipboard");
  }, [kit]);

  const handleDownload = useCallback(() => {
    const text = [
      "Xenode Recovery Kit",
      "===================",
      "",
      "Keep this file safe. These 12 words are the only way to access your",
      "encrypted files on a new device.",
      "",
      "DO NOT share these words with anyone.",
      "DO NOT store them in the cloud.",
      "",
      ...kit.words.map((w, i) => `${i + 1}. ${w}`),
      "",
      `Generated: ${new Date().toISOString()}`,
    ].join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "xenode-recovery-kit.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Recovery kit downloaded");
  }, [kit]);

  async function handleConfirm() {
    setError("");
    // Verify the 3 words match
    for (const idx of verifyIndices) {
      const input = (verifyInputs[idx] || "").trim().toLowerCase();
      if (input !== kit.words[idx]) {
        setError(`Word #${idx + 1} doesn't match. Check your recovery kit.`);
        return;
      }
    }

    setLoading(true);
    try {
      await setup(kit.passphrase);
      toast.success("Vault created! Your files are now protected.");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        {step === 1 && (
          <>
            <DialogHeader>
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <ShieldCheck className="h-6 w-6 text-primary" />
              </div>
              <DialogTitle className="text-center text-lg">Save your Recovery Kit</DialogTitle>
              <DialogDescription className="text-center text-sm text-muted-foreground">
                These 12 words are the <strong>only way</strong> to access your encrypted files
                on a new device. Store them somewhere safe — we can't recover them for you.
              </DialogDescription>
            </DialogHeader>

            {/* Word grid */}
            <div className="mt-2 grid grid-cols-3 gap-2">
              {kit.words.map((word, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2"
                >
                  <span className="text-xs text-muted-foreground w-4 shrink-0">{i + 1}.</span>
                  <span className="text-sm font-medium text-foreground">{word}</span>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2 mt-1">
              <Button variant="outline" className="flex-1" onClick={handleCopy}>
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </Button>
              <Button variant="outline" className="flex-1" onClick={handleDownload}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            </div>

            {/* Warning */}
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-600 dark:text-amber-400">
                If you lose these words and get locked out, your encrypted files cannot be recovered. Not even by us.
              </p>
            </div>

            {/* Confirm checkbox */}
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                  saved
                    ? "border-primary bg-primary"
                    : "border-border bg-transparent"
                }`}
                onClick={() => setSaved((v) => !v)}
              >
                {saved && <CheckCircle2 className="h-3.5 w-3.5 text-primary-foreground" />}
              </div>
              <span className="text-sm text-foreground">
                I've saved my recovery kit in a safe place
              </span>
            </label>

            <Button
              className="w-full"
              disabled={!saved}
              onClick={() => setStep(2)}
            >
              Continue →
            </Button>
          </>
        )}

        {step === 2 && (
          <>
            <DialogHeader>
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <CheckCircle2 className="h-6 w-6 text-primary" />
              </div>
              <DialogTitle className="text-center text-lg">Confirm your Recovery Kit</DialogTitle>
              <DialogDescription className="text-center text-sm text-muted-foreground">
                Enter the words at the positions below to confirm you've saved your kit.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-2 space-y-3">
              {verifyIndices.map((idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-16 shrink-0">
                    Word #{idx + 1}
                  </span>
                  <Input
                    placeholder={`Word #${idx + 1}`}
                    value={verifyInputs[idx] || ""}
                    onChange={(e) =>
                      setVerifyInputs((prev) => ({ ...prev, [idx]: e.target.value }))
                    }
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="lowercase"
                  />
                </div>
              ))}
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div className="flex gap-2 mt-1">
              <Button
                variant="outline"
                onClick={() => { setStep(1); setError(""); }}
                disabled={loading}
              >
                ← Back
              </Button>
              <Button
                className="flex-1"
                onClick={handleConfirm}
                disabled={loading || verifyIndices.some((idx) => !verifyInputs[idx]?.trim())}
              >
                {loading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Setting up...</>
                ) : (
                  "Confirm & protect my files"
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

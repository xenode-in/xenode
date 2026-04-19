"use client";

/**
 * SetupVaultModal
 *
 * Used in two places:
 *   1. CryptoDashboardWrapper banner → needsSetup = true
 *   2. Settings → VaultRecoverySection → regenerate kit
 *
 * Flow:
 *   Step 1 — Set master password (create + confirm)
 *   Step 2 — Save recovery kit (12 BIP39 words, copy/download, checkbox)
 *   Step 3 — Confirm 3 random words to verify they saved it
 *   → vault created, user unlocked
 */

import React, { useState, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ShieldCheck, Copy, Download, CheckCircle2,
  Loader2, AlertTriangle, Eye, EyeOff, KeyRound,
} from "lucide-react";
import { useCrypto } from "@/contexts/CryptoContext";
import { useSession } from "@/lib/auth/client";
import { generateRecoveryKit, formatRecoveryKitDownload } from "@/lib/crypto/recovery";
import { toast } from "sonner";

interface SetupVaultModalProps {
  open: boolean;
  onClose: () => void;
}

export function SetupVaultModal({ open, onClose }: SetupVaultModalProps) {
  const { setup } = useCrypto();
  const { data: session } = useSession();

  const [kit] = useState(() => generateRecoveryKit());
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: master password
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwError, setPwError] = useState("");

  // Step 2: recovery kit saved checkbox
  const [saved, setSaved] = useState(false);

  // Step 3: verify 3 random word positions
  const [verifyIndices] = useState(() => {
    const positions: number[] = [];
    while (positions.length < 3) {
      const idx = Math.floor(Math.random() * 12);
      if (!positions.includes(idx)) positions.push(idx);
    }
    return positions.sort((a, b) => a - b);
  });
  const [verifyInputs, setVerifyInputs] = useState<Record<number, string>>({});
  const [verifyError, setVerifyError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(kit.words.join(" "));
    toast.success("Recovery kit copied");
  }, [kit]);

  const handleDownload = useCallback(() => {
    const text = formatRecoveryKitDownload(kit.words);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    
    // Sanitize user name for filename
    const userName = session?.user?.name || "user";
    const sanitizedName = userName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    
    a.download = `xenode-recovery-kit-${sanitizedName}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Recovery kit downloaded");
  }, [kit, session]);

  function handlePasswordNext() {
    setPwError("");
    if (password.length < 8) { setPwError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setPwError("Passwords don&apos;t match."); return; }
    setStep(2);
  }

  async function handleConfirm() {
    setVerifyError("");
    for (const idx of verifyIndices) {
      const input = (verifyInputs[idx] || "").trim().toLowerCase();
      if (input !== kit.words[idx]) {
        setVerifyError(`Word #${idx + 1} doesn&apos;t match. Check your recovery kit.`);
        return;
      }
    }
    setLoading(true);
    try {
      await setup(password, kit.passphrase);
      toast.success("Vault protected. You&apos;re all set!");
      onClose();
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">

        {/* ── Step 1: Master Password ── */}
        {step === 1 && (
          <>
            <DialogHeader>
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <KeyRound className="h-6 w-6 text-primary" />
              </div>
              <DialogTitle className="text-center text-lg">Create your master password</DialogTitle>
              <DialogDescription className="text-center text-sm text-muted-foreground">
                This password unlocks your vault on any device. Choose something strong and memorable.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-2 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="vault-pw">Master password</Label>
                <div className="relative">
                  <Input
                    id="vault-pw"
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoFocus
                    autoComplete="new-password"
                    className="pr-10"
                  />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground"
                    tabIndex={-1}>
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="vault-confirm">Confirm password</Label>
                <Input
                  id="vault-confirm"
                  type={showPw ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat your password"
                  autoComplete="new-password"
                  onKeyDown={(e) => { if (e.key === "Enter") handlePasswordNext(); }}
                />
              </div>
              {pwError && <p className="text-sm text-destructive">{pwError}</p>}
              <Button className="w-full" onClick={handlePasswordNext} disabled={!password || !confirm}>
                Continue →
              </Button>
            </div>
          </>
        )}

        {/* ── Step 2: Save Recovery Kit ── */}
        {step === 2 && (
          <>
            <DialogHeader>
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <ShieldCheck className="h-6 w-6 text-primary" />
              </div>
              <DialogTitle className="text-center text-lg">Save your Recovery Kit</DialogTitle>
              <DialogDescription className="text-center text-sm text-muted-foreground">
                If you ever forget your master password, these 12 words are the only way to recover your vault.
                Store them somewhere safe.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-2 grid grid-cols-3 gap-2">
              {kit.words.map((word, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                  <span className="text-xs text-muted-foreground w-4 shrink-0">{i + 1}.</span>
                  <span className="text-sm font-medium text-foreground">{word}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-1">
              <Button variant="outline" className="flex-1" onClick={handleCopy}>
                <Copy className="mr-2 h-4 w-4" /> Copy
              </Button>
              <Button variant="outline" className="flex-1" onClick={handleDownload}>
                <Download className="mr-2 h-4 w-4" /> Download
              </Button>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-600 dark:text-amber-400">
                These words only work together with your master password. Neither alone can unlock your vault.
              </p>
            </div>

            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                  saved ? "border-primary bg-primary" : "border-border bg-transparent"
                }`}
                onClick={() => setSaved(v => !v)}
              >
                {saved && <CheckCircle2 className="h-3.5 w-3.5 text-primary-foreground" />}
              </div>
              <span className="text-sm text-foreground">I&apos;ve saved my recovery kit in a safe place</span>
            </label>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
              <Button className="flex-1" disabled={!saved} onClick={() => setStep(3)}>
                Continue →
              </Button>
            </div>
          </>
        )}

        {/* ── Step 3: Verify 3 words ── */}
        {step === 3 && (
          <>
            <DialogHeader>
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <CheckCircle2 className="h-6 w-6 text-primary" />
              </div>
              <DialogTitle className="text-center text-lg">Confirm your Recovery Kit</DialogTitle>
              <DialogDescription className="text-center text-sm text-muted-foreground">
                Enter the words at the positions below to confirm you&apos;ve saved your kit.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-2 space-y-3">
              {verifyIndices.map((idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-16 shrink-0">Word #{idx + 1}</span>
                  <Input
                    placeholder={`Word #${idx + 1}`}
                    value={verifyInputs[idx] || ""}
                    onChange={(e) => setVerifyInputs(prev => ({ ...prev, [idx]: e.target.value }))}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="lowercase"
                  />
                </div>
              ))}
            </div>

            {verifyError && <p className="text-sm text-destructive">{verifyError}</p>}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setStep(2); setVerifyError(""); }} disabled={loading}>
                ← Back
              </Button>
              <Button
                className="flex-1"
                onClick={handleConfirm}
                disabled={loading || verifyIndices.some(idx => !verifyInputs[idx]?.trim())}
              >
                {loading
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Setting up...</>
                  : "Confirm & protect my files"
                }
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

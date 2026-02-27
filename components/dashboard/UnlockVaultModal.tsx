"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Lock,
  KeyRound,
  Loader2,
  Eye,
  EyeOff,
  ShieldCheck,
  Fingerprint,
} from "lucide-react";
import { useCrypto } from "@/contexts/CryptoContext";

interface UnlockVaultModalProps {
  open: boolean;
  onClose: () => void;
}

export function UnlockVaultModal({ open, onClose }: UnlockVaultModalProps) {
  const { needsSetup, vaultType, unlock, setup, unlockWithPRF } = useCrypto();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [prfFailed, setPrfFailed] = useState(false);
  const [prfAttempted, setPrfAttempted] = useState(false);

  const isSetup = needsSetup;

  /**
   * For 'both' vaults: silently try PRF when modal opens.
   * If PRF succeeds → vault unlocks, modal closes automatically.
   * If PRF fails → show passphrase input as fallback.
   */
  useEffect(() => {
    if (!open || prfAttempted || isSetup) return;
    if (vaultType !== "both") return;

    setPrfAttempted(true);

    async function tryPRFSilently() {
      try {
        const result = await unlockWithPRF();
        if (result.supported) {
          // PRF worked — modal will close via isUnlocked in wrapper
          onClose();
        } else {
          // PRF not supported on this device → show passphrase
          setPrfFailed(true);
        }
      } catch {
        // Any error → fall back to passphrase silently
        setPrfFailed(true);
      }
    }

    tryPRFSilently();
  }, [open, vaultType, prfAttempted, isSetup, unlockWithPRF, onClose]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setPrfAttempted(false);
      setPrfFailed(false);
      setPassword("");
      setConfirm("");
      setError("");
    }
  }, [open]);

  // ── Manual PRF unlock button (for vaultType 'prf' legacy) ─────────────
  async function handlePRFUnlock() {
    setError("");
    setLoading(true);
    try {
      const result = await unlockWithPRF();
      if (!result.supported) {
        setPrfFailed(true);
        setError("Passkey unlock isn't supported on this browser. Enter your passphrase instead.");
        return;
      }
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "Passkey authentication cancelled") {
        setError("Cancelled. Try again or use your passphrase.");
      } else {
        setPrfFailed(true);
        setError("Passkey unlock failed. Try your passphrase instead.");
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Passphrase submit ─────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (isSetup && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      if (isSetup) {
        await setup(password);
      } else {
        await unlock(password);
      }
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message === "WRONG_PASSWORD") {
          setError("Incorrect passphrase. Please try again.");
        } else {
          setError(err.message || "An error occurred. Please try again.");
        }
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Determine what to show ────────────────────────────────────────────
  // 'both' + PRF not yet attempted = loading spinner (PRF trying silently)
  // 'both' + PRF failed = passphrase input
  // 'both' + PRF succeeded = modal closes (handled above)
  // 'prf' (legacy) = passkey button
  // 'passphrase' = passphrase input
  // needsSetup = setup form
  const showPRFLoading = vaultType === "both" && !prfAttempted && !isSetup;
  const showPRFButton = (vaultType === "prf" && !prfFailed) && !isSetup;
  const showPassphrase = isSetup || vaultType === "passphrase" || (vaultType === "both" && prfFailed) || (vaultType === "prf" && prfFailed);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            {isSetup ? (
              <ShieldCheck className="h-6 w-6 text-primary" />
            ) : showPRFLoading || showPRFButton ? (
              <Fingerprint className="h-6 w-6 text-primary" />
            ) : (
              <Lock className="h-6 w-6 text-primary" />
            )}
          </div>

          <DialogTitle className="text-center text-lg">
            {isSetup ? "Set up file encryption" : "Unlock your files"}
          </DialogTitle>

          <DialogDescription className="text-center text-sm text-muted-foreground">
            {isSetup
              ? "Create an encryption passphrase to protect your files end-to-end."
              : showPRFLoading
              ? "Checking your passkey..."
              : showPRFButton
              ? "Use your passkey to decrypt your files."
              : "Enter your encryption passphrase to decrypt your files."}
          </DialogDescription>
        </DialogHeader>

        {/* PRF loading state — silent attempt for 'both' vaults */}
        {showPRFLoading && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Checking your passkey...</p>
          </div>
        )}

        {/* Legacy PRF-only vault — manual passkey button */}
        {showPRFButton && (
          <div className="mt-2 space-y-4">
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <Button type="button" className="w-full" onClick={handlePRFUnlock} disabled={loading}>
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Unlocking...</>
              ) : (
                <><Fingerprint className="mr-2 h-4 w-4" /> Unlock with Passkey</>
              )}
            </Button>
            <button type="button"
              className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
              onClick={() => setPrfFailed(true)}>
              Use passphrase instead →
            </button>
          </div>
        )}

        {/* Passphrase form — setup, passphrase vault, or PRF fallback */}
        {showPassphrase && (
          <form onSubmit={handleSubmit} className="mt-2 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vault-password">
                {isSetup ? "Encryption passphrase" : "Passphrase"}
              </Label>
              <div className="relative">
                <Input
                  id="vault-password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your encryption passphrase"
                  className="pr-10"
                  autoFocus
                  autoComplete={isSetup ? "new-password" : "current-password"}
                  required
                />
                <button type="button" onClick={() => setShowPw((v) => !v)}
                  className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground"
                  tabIndex={-1}>
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {isSetup && (
              <div className="space-y-2">
                <Label htmlFor="vault-confirm">Confirm passphrase</Label>
                <Input id="vault-confirm"
                  type={showPw ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Confirm your passphrase"
                  autoComplete="new-password"
                  required
                />
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isSetup ? "Setting up..." : "Unlocking..."}
                </>
              ) : (
                <><KeyRound className="mr-2 h-4 w-4" />
                  {isSetup ? "Set up encryption" : "Unlock files"}
                </>
              )}
            </Button>

            {/* If fell back from PRF — offer to retry passkey */}
            {prfFailed && !isSetup && (
              <button type="button"
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
                onClick={() => { setPrfFailed(false); setPrfAttempted(false); setError(""); }}>
                ← Try passkey instead
              </button>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

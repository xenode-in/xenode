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
  Fingerprint,
} from "lucide-react";
import { useCrypto } from "@/contexts/CryptoContext";
import { toast } from "sonner";

interface UnlockVaultModalProps {
  open: boolean;
  onClose: () => void;
}

// Three UI modes for this modal
type ModalMode =
  | "prf"              // PRF vault: show passkey button
  | "passphrase"       // Passphrase vault: show passphrase input
  | "set-passphrase"   // PRF user setting a passphrase backup
  | "loading";         // Silently trying PRF for 'both' vaults

export function UnlockVaultModal({ open, onClose }: UnlockVaultModalProps) {
  const { vaultType, unlock, unlockWithPRF, addPassphraseLayer } = useCrypto();

  const [mode, setMode] = useState<ModalMode>("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ── Determine initial mode + handle silent PRF for 'both' ────────────────
  useEffect(() => {
    if (!open) return;

    if (vaultType === "passphrase") {
      setMode("passphrase");
      return;
    }

    if (vaultType === "prf") {
      setMode("prf");
      return;
    }

    if (vaultType === "both") {
      // Try PRF silently first
      setMode("loading");
      unlockWithPRF()
        .then((result) => {
          if (result.supported) {
            onClose(); // PRF worked — vault unlocked
          } else {
            setMode("passphrase"); // PRF not supported on this device
          }
        })
        .catch(() => {
          setMode("passphrase"); // Any error → passphrase fallback
        });
      return;
    }
  }, [open, vaultType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setMode("loading");
      setPassword("");
      setConfirm("");
      setError("");
      setShowPw(false);
    }
  }, [open]);

  // ── PRF unlock ────────────────────────────────────────────────────────────
  async function handlePRFUnlock() {
    setError("");
    setLoading(true);
    try {
      const result = await unlockWithPRF();
      if (!result.supported) {
        setError("Passkey isn't supported on this browser. Set a passphrase backup below.");
        setMode("passphrase");
        return;
      }
      onClose();
    } catch (err) {
      if (err instanceof Error && err.message === "Passkey authentication cancelled") {
        setError("Cancelled. Try again or set a passphrase backup.");
      } else {
        setError("Passkey unlock failed. Set a passphrase backup instead.");
        setMode("passphrase");
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Passphrase unlock ─────────────────────────────────────────────────────
  async function handlePassphraseUnlock(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Passphrase must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      await unlock(password);
      onClose();
    } catch (err) {
      if (err instanceof Error && err.message === "WRONG_PASSWORD") {
        setError("Incorrect passphrase. Please try again.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Set passphrase backup (PRF user, passkey unavailable on this device) ──
  async function handleSetPassphraseBackup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Passphrase must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passphrases do not match.");
      return;
    }
    setLoading(true);
    try {
      // This will prompt the passkey biometric to decrypt the private key,
      // then re-encrypt it with the new passphrase and save both layers.
      await addPassphraseLayer(password);
      toast.success("Passphrase backup set! Your vault is now unlocked.");
      // After adding passphrase, unlock with it immediately
      await unlock(password);
      onClose();
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === "PRF_NOT_SUPPORTED") {
          setError("Your passkey isn't available here. Try on the device where you registered it.");
        } else if (err.message === "Passkey authentication cancelled") {
          setError("Cancelled. Your passkey is needed to set a passphrase backup.");
        } else {
          setError(err.message || "Something went wrong.");
        }
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const titles: Record<ModalMode, string> = {
    loading: "Unlocking your files...",
    prf: "Unlock your files",
    passphrase: "Unlock your files",
    "set-passphrase": "Set a passphrase backup",
  };

  const descriptions: Record<ModalMode, string> = {
    loading: "Checking your passkey...",
    prf: "Use your passkey to unlock your encrypted files.",
    passphrase: "Enter your encryption passphrase to access your files.",
    "set-passphrase":
      "Your passkey isn't available on this device. Set a passphrase backup so you can always access your files — your passkey will verify your identity first.",
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            {mode === "loading" ? (
              <Loader2 className="h-6 w-6 text-primary animate-spin" />
            ) : mode === "prf" ? (
              <Fingerprint className="h-6 w-6 text-primary" />
            ) : (
              <Lock className="h-6 w-6 text-primary" />
            )}
          </div>
          <DialogTitle className="text-center text-lg">
            {titles[mode]}
          </DialogTitle>
          <DialogDescription className="text-center text-sm text-muted-foreground">
            {descriptions[mode]}
          </DialogDescription>
        </DialogHeader>

        {/* Loading state — silent PRF attempt */}
        {mode === "loading" && (
          <div className="flex flex-col items-center gap-2 py-4">
            <p className="text-sm text-muted-foreground">Checking your passkey...</p>
          </div>
        )}

        {/* PRF vault — passkey button */}
        {mode === "prf" && (
          <div className="mt-2 space-y-4">
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <Button
              type="button"
              className="w-full"
              onClick={handlePRFUnlock}
              disabled={loading}
            >
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Unlocking...</>
              ) : (
                <><Fingerprint className="mr-2 h-4 w-4" /> Unlock with Passkey</>
              )}
            </Button>
            <button
              type="button"
              className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
              onClick={() => { setError(""); setMode("set-passphrase"); }}
            >
              Passkey not available on this device? Set a passphrase backup →
            </button>
          </div>
        )}

        {/* Passphrase vault — passphrase input */}
        {mode === "passphrase" && (
          <form onSubmit={handlePassphraseUnlock} className="mt-2 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vault-password">Passphrase</Label>
              <div className="relative">
                <Input
                  id="vault-password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your encryption passphrase"
                  className="pr-10"
                  autoFocus
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Unlocking...</>
              ) : (
                <><KeyRound className="mr-2 h-4 w-4" /> Unlock files</>
              )}
            </Button>
            {/* Only show 'try passkey' if this is a fallback from 'both' vault */}
            {vaultType === "both" && (
              <button
                type="button"
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
                onClick={() => { setError(""); setMode("loading"); }}
              >
                ← Try passkey instead
              </button>
            )}
          </form>
        )}

        {/* Set passphrase backup — for PRF users whose passkey isn't synced here */}
        {mode === "set-passphrase" && (
          <form onSubmit={handleSetPassphraseBackup} className="mt-2 space-y-4">
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Your passkey will be prompted to verify your identity before the passphrase is saved.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="backup-password">New passphrase</Label>
              <div className="relative">
                <Input
                  id="backup-password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Choose a passphrase (min 8 chars)"
                  className="pr-10"
                  autoFocus
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="backup-confirm">Confirm passphrase</Label>
              <Input
                id="backup-confirm"
                type={showPw ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm your passphrase"
                autoComplete="new-password"
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Setting up...</>
              ) : (
                <><KeyRound className="mr-2 h-4 w-4" /> Set passphrase backup</>
              )}
            </Button>
            <button
              type="button"
              className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
              onClick={() => { setError(""); setMode("prf"); }}
            >
              ← Try passkey again
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

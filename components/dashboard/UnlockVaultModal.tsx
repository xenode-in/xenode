"use client";

import React, { useState } from "react";
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
  ShieldAlert,
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
  // If PRF unlock fails on this device, show passphrase fallback
  const [prfFailed, setPrfFailed] = useState(false);

  const isSetup = needsSetup;
  const isPRFVault = vaultType === "prf" && !isSetup && !prfFailed;

  // ── PRF unlock ──────────────────────────────────────────────────────────
  async function handlePRFUnlock() {
    setError("");
    setLoading(true);
    try {
      const result = await unlockWithPRF();
      if (!result.supported) {
        // PRF not supported on this device (Windows Hello, Firefox)
        // Fall back to passphrase
        setPrfFailed(true);
        setError(
          "Passkey unlock isn't supported on this browser. Enter your passphrase instead.",
        );
        return;
      }
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message === "Passkey authentication cancelled") {
          setError("Passkey authentication cancelled.");
        } else if (err.message === "PRF_DECRYPT_FAILED") {
          // Passkey authenticated but wrong key — shouldn't happen unless vault corrupted
          setError("Vault decryption failed. Try your passphrase instead.");
          setPrfFailed(true);
        } else {
          setError("Passkey unlock failed. Try your passphrase instead.");
          setPrfFailed(true);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Passphrase submit ────────────────────────────────────────────────────
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
          setError("Incorrect password. Please try again.");
        } else {
          setError(err.message || "An error occurred. Please try again.");
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            {isSetup ? (
              <ShieldCheck className="h-6 w-6 text-primary" />
            ) : isPRFVault ? (
              <Fingerprint className="h-6 w-6 text-primary" />
            ) : prfFailed ? (
              <ShieldAlert className="h-6 w-6 text-amber-500" />
            ) : (
              <Lock className="h-6 w-6 text-primary" />
            )}
          </div>

          <DialogTitle className="text-center text-lg">
            {isSetup
              ? "Set up file encryption"
              : isPRFVault
              ? "Unlock your files"
              : "Unlock your files"}
          </DialogTitle>

          <DialogDescription className="text-center text-sm text-muted-foreground">
            {isSetup
              ? "Create an encryption password to protect your files end-to-end."
              : isPRFVault
              ? "Use your passkey to decrypt your files. Your biometric never leaves this device."
              : prfFailed
              ? "Enter your encryption passphrase as a fallback."
              : "Enter your encryption password to decrypt your files."}
          </DialogDescription>
        </DialogHeader>

        {/* ── PRF path: biometric button ── */}
        {isPRFVault && (
          <div className="mt-2 space-y-4">
            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}
            <Button
              type="button"
              className="w-full"
              onClick={handlePRFUnlock}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Unlocking...
                </>
              ) : (
                <>
                  <Fingerprint className="mr-2 h-4 w-4" />
                  Unlock with Passkey
                </>
              )}
            </Button>
            <button
              type="button"
              className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
              onClick={() => setPrfFailed(true)}
            >
              Use passphrase instead →
            </button>
          </div>
        )}

        {/* ── Passphrase path: password form ── */}
        {!isPRFVault && (
          <form onSubmit={handleSubmit} className="mt-2 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vault-password">
                {isSetup ? "Encryption password" : "Passphrase"}
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
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                  aria-label="Toggle password visibility"
                >
                  {showPw ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {isSetup && (
              <div className="space-y-2">
                <Label htmlFor="vault-confirm">Confirm password</Label>
                <Input
                  id="vault-confirm"
                  type={showPw ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Confirm your password"
                  autoComplete="new-password"
                  required
                />
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isSetup ? "Setting up..." : "Unlocking..."}
                </>
              ) : (
                <>
                  <KeyRound className="mr-2 h-4 w-4" />
                  {isSetup ? "Set up encryption" : "Unlock files"}
                </>
              )}
            </Button>

            {/* If PRF vault but fell back — offer to try passkey again */}
            {prfFailed && !isSetup && (
              <button
                type="button"
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
                onClick={() => {
                  setPrfFailed(false);
                  setError("");
                }}
              >
                ← Try passkey instead
              </button>
            )}

            {!isSetup && !prfFailed && (
              <p className="text-center text-xs text-muted-foreground">
                Files uploaded before encryption was enabled are still
                accessible without a password.
              </p>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

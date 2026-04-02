"use client";

/**
 * UnlockVaultModal
 *
 * Shown when vault exists but IDB cache is empty (new device / after lock).
 * User enters their MASTER PASSWORD only — recovery words not needed for normal unlock.
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Lock,
  KeyRound,
  Loader2,
  Eye,
  EyeOff,
  ShieldCheck,
} from "lucide-react";
import { useCrypto } from "@/contexts/CryptoContext";

interface UnlockVaultModalProps {
  open: boolean;
  onClose: () => void;
}

export function UnlockVaultModal({ open, onClose }: UnlockVaultModalProps) {
  const { unlock, recover } = useCrypto();
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [recoveryWords, setRecoveryWords] = useState("");
  const [newPassword, setNewPassword] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!password.trim()) return;

    setLoading(true);
    try {
      await unlock(password);
      setPassword("");
      onClose();
    } catch (err) {
      console.log(err);
      if (err instanceof Error && err.message === "WRONG_PASSWORD") {
        setError("Incorrect password. Please try again.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRecoverSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!recoveryWords.trim() || !newPassword.trim()) return;
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      await recover(recoveryWords.trim(), newPassword);
      setRecoveryWords("");
      setNewPassword("");
      setIsRecoveryMode(false);
      onClose();
    } catch (err) {
      if (err instanceof Error && err.message === "INVALID_RECOVERY_KIT") {
        setError("Invalid recovery kit. Please check your words.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      setLoading(false);
    }
  }

  if (isRecoveryMode) {
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
              <ShieldCheck className="h-6 w-6 text-primary" />
            </div>
            <DialogTitle className="text-center text-lg">
              Recover your vault
            </DialogTitle>
            <DialogDescription className="text-center text-sm text-muted-foreground">
              Enter your 12-word recovery kit and set a new master password to
              regain access to your files.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleRecoverSubmit} className="mt-2 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="recovery-words">Recovery kit (12 words)</Label>
              <Input
                id="recovery-words"
                value={recoveryWords}
                onChange={(e) => setRecoveryWords(e.target.value)}
                placeholder="e.g. apple banana cherry..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-pw">New master password</Label>
              <Input
                id="new-pw"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={loading}
                onClick={() => {
                  setIsRecoveryMode(false);
                  setError("");
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="w-full"
                disabled={
                  loading || !recoveryWords.trim() || !newPassword.trim()
                }
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                    Recovering...
                  </>
                ) : (
                  "Recover Vault"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    );
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
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center text-lg">
            Unlock your vault
          </DialogTitle>
          <DialogDescription className="text-center text-sm text-muted-foreground">
            Enter your master password to decrypt your files on this device.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-2 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="unlock-pw">Master password</Label>
            <div className="relative">
              <Input
                id="unlock-pw"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your master password"
                autoFocus
                autoComplete="current-password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPw ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            type="submit"
            className="w-full"
            disabled={loading || !password.trim()}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Unlocking...
              </>
            ) : (
              <>
                <KeyRound className="mr-2 h-4 w-4" /> Unlock vault
              </>
            )}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Forgot your password?{" "}
            <button
              type="button"
              onClick={() => {
                setIsRecoveryMode(true);
                setError("");
              }}
              className="text-primary hover:underline"
            >
              Recover with your recovery kit →
            </button>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}

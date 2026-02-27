"use client";

/**
 * UnlockVaultModal
 *
 * Shown when vault exists but IDB cache is empty (new device / after lock).
 * User enters their MASTER PASSWORD only — recovery words not needed for normal unlock.
 */

import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, KeyRound, Loader2, Eye, EyeOff } from "lucide-react";
import { useCrypto } from "@/contexts/CryptoContext";

interface UnlockVaultModalProps {
  open: boolean;
  onClose: () => void;
}

export function UnlockVaultModal({ open, onClose }: UnlockVaultModalProps) {
  const { unlock } = useCrypto();
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
      if (err instanceof Error && err.message === "WRONG_PASSWORD") {
        setError("Incorrect password. Please try again.");
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
          <DialogTitle className="text-center text-lg">Unlock your vault</DialogTitle>
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
              <button type="button" onClick={() => setShowPw(v => !v)}
                className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground"
                tabIndex={-1}>
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading || !password.trim()}>
            {loading
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Unlocking...</>
              : <><KeyRound className="mr-2 h-4 w-4" /> Unlock vault</>
            }
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Forgot your password?{" "}
            <a href="/dashboard/settings" className="text-primary hover:underline">
              Recover with your recovery kit →
            </a>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}

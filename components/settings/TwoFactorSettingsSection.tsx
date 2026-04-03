"use client";

import { useState } from "react";
import { ShieldCheck, ShieldAlert, KeyRound, Copy, Download, RefreshCw, Loader2, CheckCircle2, AlertTriangle, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, useSession } from "@/lib/auth/client";
import { toast } from "sonner";
import QRCode from "react-qr-code";

export function TwoFactorSettingsSection() {
  const { data: session, isPending: sessionPending } = useSession();
  const twoFactorEnabled = !!session?.user?.twoFactorEnabled;

  const [setupDialogOpen, setSetupDialogOpen] = useState(false);
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [viewBackupCodesOpen, setViewBackupCodesOpen] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [totpData, setTotpData] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [setupStep, setSetupStep] = useState<"password" | "qrcode" | "verify">("password");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  const resetSetup = () => {
    setSetupDialogOpen(false);
    setSetupStep("password");
    setPassword("");
    setTotpData(null);
    setOtpCode("");
  };

  const handleStartSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await authClient.twoFactor.enable({
        password,
      });

      if (error) {
        toast.error(error.message || "Failed to start 2FA setup");
        return;
      }

      if (data) {
        setTotpData(data);
        setBackupCodes(data.backupCodes);
        setSetupStep("qrcode");
      }
    } catch (err) {
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({
        code: otpCode,
      });

      if (error) {
        toast.error(error.message || "Invalid OTP code");
        return;
      }

      toast.success("Two-factor authentication enabled!");
      resetSetup();
    } catch (err) {
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await authClient.twoFactor.disable({
        password,
      });

      if (error) {
        toast.error(error.message || "Failed to disable 2FA");
        return;
      }

      toast.success("Two-factor authentication disabled");
      setDisableDialogOpen(false);
      setPassword("");
    } catch (err) {
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleViewBackupCodes = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Better-Auth generateBackupCodes actually returns the current ones if not rotated, 
      // or we might need a specific "view" method if available.
      // Based on types, generateBackupCodes is what we have.
      const { data, error } = await authClient.twoFactor.generateBackupCodes({
        password,
      });

      if (error) {
        toast.error(error.message || "Failed to retrieve backup codes");
        return;
      }

      if (data) {
        setBackupCodes(data.backupCodes);
        setViewBackupCodesOpen(false);
        // Show them in a sub-state or another modal
        setTotpData({ totpURI: "", backupCodes: data.backupCodes }); 
        setSetupStep("verify"); // Repurposing verify step UI for backup codes display if needed, or better, a dedicated state
      }
    } catch (err) {
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const copyBackupCodes = () => {
    navigator.clipboard.writeText(backupCodes.join("\n"));
    toast.success("Backup codes copied to clipboard");
  };

  const downloadBackupCodes = () => {
    const blob = new Blob([backupCodes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "xenode-2fa-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (sessionPending) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between py-3 border-b border-border">
        <div>
          <p className="text-sm text-foreground flex items-center gap-1.5">
            {twoFactorEnabled ? (
              <ShieldCheck className="w-3.5 h-3.5 text-primary" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5 text-muted-foreground" />
            )}
            Two-Factor Authentication (TOTP)
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {twoFactorEnabled 
              ? "Your account is protected with 2FA." 
              : "Add an extra layer of security to your account."}
          </p>
        </div>
        <div className="flex gap-2">
          {twoFactorEnabled ? (
            <>
              <Button size="sm" variant="outline" onClick={() => {
                setBackupCodes([]); // Clear old ones
                setViewBackupCodesOpen(true);
              }}>
                Backup Codes
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setDisableDialogOpen(true)}>
                Disable
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => setSetupDialogOpen(true)}>
              Enable 2FA
            </Button>
          )}
        </div>
      </div>

      {/* Setup 2FA Dialog */}
      <Dialog open={setupDialogOpen} onOpenChange={(open) => !open && resetSetup()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set up Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              Increase your account security by requiring a code from an authenticator app.
            </DialogDescription>
          </DialogHeader>

          {setupStep === "password" && (
            <form onSubmit={handleStartSetup} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="setup-password">Confirm Password</Label>
                <Input
                  id="setup-password"
                  type="password"
                  placeholder="Enter your account password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={loading} className="w-full">
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Continue
                </Button>
              </DialogFooter>
            </form>
          )}

          {setupStep === "qrcode" && totpData && (
            <div className="space-y-6 py-4">
              <div className="flex flex-col items-center justify-center space-y-4">
                <div className="p-4 bg-white rounded-xl">
                  <QRCode value={totpData.totpURI} size={180} />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">Scan this QR code</p>
                  <p className="text-xs text-muted-foreground max-w-[280px]">
                    Use an authenticator app (like Google Authenticator, Raivo, or Proton Pass) to scan this code.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 flex gap-3">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">Save your backup codes!</p>
                    <p className="text-[11px] text-amber-600/80 dark:text-amber-400/80 leading-tight">
                      These codes allow you to log in if you lose your phone. Store them somewhere safe.
                    </p>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto p-2 border border-border rounded-lg bg-muted/30">
                  {totpData.backupCodes.map((code, i) => (
                    <code key={i} className="text-[10px] font-mono p-1 bg-background rounded border border-border text-center">
                      {code}
                    </code>
                  ))}
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={copyBackupCodes}>
                    <Copy className="mr-1.5 h-3 w-3" /> Copy
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={downloadBackupCodes}>
                    <Download className="mr-1.5 h-3 w-3" /> Download
                  </Button>
                </div>
              </div>

              <Button onClick={() => setSetupStep("verify")} className="w-full">
                I've scanned the code →
              </Button>
            </div>
          )}

          {setupStep === "verify" && (
            <form onSubmit={handleVerifyOtp} className="space-y-4 py-4">
              <div className="space-y-2 text-center">
                <Label htmlFor="otp-code">Enter 6-digit Code</Label>
                <p className="text-xs text-muted-foreground">Enter the code shown in your authenticator app.</p>
                <Input
                  id="otp-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  className="text-center text-lg tracking-[0.5em] font-mono h-12"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ""))}
                  required
                  autoFocus
                />
              </div>
              <DialogFooter>
                <div className="flex w-full gap-2">
                  <Button variant="outline" onClick={() => setSetupStep("qrcode")} type="button">Back</Button>
                  <Button type="submit" disabled={loading || otpCode.length !== 6} className="flex-1">
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Verify & Enable
                  </Button>
                </div>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Disable 2FA Dialog */}
      <Dialog open={disableDialogOpen} onOpenChange={setDisableDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Disable Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              Are you sure? Removing 2FA makes your account less secure.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleDisable} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="disable-password">Confirm Password</Label>
              <Input
                id="disable-password"
                type="password"
                placeholder="Enter your account password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="destructive" type="submit" disabled={loading} className="w-full">
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Disable 2FA
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View Backup Codes Confirmation Dialog */}
      <Dialog open={viewBackupCodesOpen} onOpenChange={setViewBackupCodesOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>View Backup Codes</DialogTitle>
            <DialogDescription>
              You must confirm your password to view your emergency backup codes.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleViewBackupCodes} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="view-password">Confirm Password</Label>
              <Input
                id="view-password"
                type="password"
                placeholder="Enter your account password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={loading} className="w-full">
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                View Codes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      
      {/* Dedicate state for showing retrieved backup codes */}
      {backupCodes.length > 0 && !setupDialogOpen && (
        <Dialog open={backupCodes.length > 0} onOpenChange={() => { setBackupCodes([]); setPassword(""); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Your Backup Codes</DialogTitle>
              <DialogDescription>
                Keep these codes in a safe place. Each code can be used once to log in if you lose your phone.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-2 p-3 border border-border rounded-lg bg-muted/30">
                {backupCodes.map((code, i) => (
                  <code key={i} className="text-xs font-mono p-1.5 bg-background rounded border border-border text-center">
                    {code}
                  </code>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={copyBackupCodes}>
                  <Copy className="mr-2 h-4 w-4" /> Copy
                </Button>
                <Button variant="outline" className="flex-1" onClick={downloadBackupCodes}>
                  <Download className="mr-2 h-4 w-4" /> Download
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => { setBackupCodes([]); setPassword(""); }} className="w-full">
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

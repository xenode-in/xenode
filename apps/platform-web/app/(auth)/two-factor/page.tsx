"use client";

import { useState, Suspense, lazy, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ShieldCheck, ArrowLeft } from "lucide-react";
import { GradualSpacing } from "@/components/ui/gradual-spacing";
import { toast } from "sonner";

const Dithering = lazy(() =>
  import("@paper-design/shaders-react").then((mod) => ({
    default: mod.Dithering,
  })),
);

function TwoFactorForm() {
  const router = useRouter();
  const [isHovered, setIsHovered] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isBackupCode, setIsBackupCode] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      let result;
      if (isBackupCode) {
        result = await authClient.twoFactor.verifyBackupCode({
          code: code.trim(),
        });
      } else {
        result = await authClient.twoFactor.verifyTotp({
          code: code.trim(),
          trustDevice,
        });
      }

      if (result.error) {
        setError(result.error.message || "Invalid code. Please try again.");
        setIsLoading(false);
        return;
      }

      toast.success("Authenticated successfully");
      // Use window.location.href to ensure a hard reload so that the
      // cookie is properly picked up by Next.js Server Components.
      window.location.href = "/dashboard";
    } catch {
      setError("Something went wrong. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Left panel - Dithering Animation */}
      <div
        className="hidden lg:flex lg:w-1/2 relative flex-col justify-between overflow-hidden border-r border-border bg-card"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Suspense fallback={<div className="absolute inset-0 bg-muted" />}>
          <div className="absolute inset-0 z-0 opacity-80 dark:opacity-60 mix-blend-multiply dark:mix-blend-screen pointer-events-none">
            <Dithering
              colorBack="#00000000"
              colorFront="#7cb686"
              shape="warp"
              type="4x4"
              speed={isHovered ? 0.6 : 0.2}
              className="w-full h-full"
              minPixelRatio={1}
            />
          </div>
        </Suspense>

        <div className="relative z-10 p-12 h-full flex flex-col justify-between text-foreground">
          <Link href="/" className="inline-block">
            <span className="text-4xl font-brand italic text-foreground tracking-tight drop-shadow-sm">
              Xenode
            </span>
          </Link>

          <div className="backdrop-blur-md bg-background/40 p-8 rounded-3xl border border-border/50 max-w-lg min-h-16 flex flex-col justify-center">
            <p className="text-base text-foreground/80 mb-3 font-medium tracking-wide uppercase">
              Security
            </p>
            <div className="min-h-16 flex items-center justify-start overflow-hidden">
              <GradualSpacing
                text="Two-factor authentication is required to access your account."
                className="text-2xl font-semibold leading-tight text-foreground text-left wrap-break-word"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col justify-center px-8 sm:px-16 md:px-24 lg:px-32 xl:px-40 py-12 overflow-y-auto">
        <div className="w-full max-w-md mx-auto space-y-8">
          <div className="lg:hidden mb-10 text-center">
            <Link href="/">
              <span className="text-4xl font-brand italic text-foreground">
                Xenode
              </span>
            </Link>
          </div>

          <div className="space-y-4">
            <Link
              href="/login"
              className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors group"
            >
              <ArrowLeft className="w-4 h-4 mr-2 transition-transform group-hover:-translate-x-1" />
              Back to login
            </Link>
            <div className="space-y-2">
              <h1 className="text-4xl font-semibold tracking-tight text-foreground">
                Two-factor Check
              </h1>
              <p className="text-base text-muted-foreground">
                {isBackupCode
                  ? "Enter one of your emergency backup codes to sign in."
                  : "Enter the code from your authenticator app to continue."}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-3">
              <Label htmlFor="code" className="text-sm font-medium">
                {isBackupCode ? "Backup Code" : "6-digit Code"}
              </Label>
              <Input
                id="code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={isBackupCode ? "Enter backup code" : "000000"}
                className={`h-14 bg-background border-input focus-visible:ring-primary/20 text-xl font-medium ${!isBackupCode ? "text-center tracking-[0.5em] font-mono" : ""}`}
                required
                autoFocus
                autoComplete="one-time-code"
                maxLength={isBackupCode ? 20 : 6}
              />
            </div>

            {!isBackupCode && (
              <div className="flex items-center space-x-2 py-1">
                <Checkbox
                  id="trustDevice"
                  checked={trustDevice}
                  onCheckedChange={(checked) => setTrustDevice(!!checked)}
                />
                <Label
                  htmlFor="trustDevice"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  Trust this device for 30 days
                </Label>
              </div>
            )}

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 font-medium">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={isLoading || (!isBackupCode && code.length !== 6)}
              className="w-full h-12 text-base font-medium transition-all hover:-translate-y-0.5 mt-2"
            >
              {isLoading && <Loader2 className="w-5 h-5 animate-spin mr-2" />}
              Verify Code
            </Button>
          </form>

          <p className="text-center text-sm mt-8 text-muted-foreground">
            {isBackupCode ? (
              <button
                type="button"
                onClick={() => {
                  setIsBackupCode(false);
                  setCode("");
                  setError("");
                }}
                className="text-primary hover:underline font-semibold"
              >
                Use authenticator app
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setIsBackupCode(true);
                  setCode("");
                  setError("");
                }}
                className="text-primary hover:underline font-semibold"
              >
                Loss access to your device? Use a backup code
              </button>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function TwoFactorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-full items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <TwoFactorForm />
    </Suspense>
  );
}

"use client";

import { useEffect, useState, Suspense, lazy } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Mail, Loader2, CheckCircle2 } from "lucide-react";
import { useSession, authClient } from "@/lib/auth/client";
import { toast } from "sonner";

const Dithering = lazy(() =>
  import("@paper-design/shaders-react").then((mod) => ({
    default: mod.Dithering,
  })),
);

function getOnboardedFlag(user: unknown): boolean {
  if (!user || typeof user !== "object" || !("onboarded" in user)) {
    return false;
  }

  return !!(user as { onboarded?: boolean }).onboarded;
}

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailParam = searchParams.get("email");
  const errorParam = searchParams.get("error");
  const { data: session, isPending } = useSession();
  const [isResending, setIsResending] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [resendCount, setResendCount] = useState(0);

  const targetEmail = session?.user?.email || emailParam;
  const hasVaultBootstrap =
    typeof window !== "undefined" &&
    !!window.sessionStorage.getItem("xenode-vault-pw");
  const isVerified = !!session?.user?.emailVerified;
  const isOnboarded = getOnboardedFlag(session?.user);
  const shouldResumeOnboarding = isVerified && !isOnboarded && hasVaultBootstrap;

  // Handle errors from the email link
  useEffect(() => {
    if (errorParam === "TOKEN_EXPIRED") {
      toast.error("Your verification link has expired. Please request a new one.");
    } else if (errorParam === "INVALID_TOKEN") {
      toast.error("Invalid verification link. Please request a new one.");
    } else if (errorParam) {
      toast.error("Failed to verify email. Please try again.");
    }
  }, [errorParam]);

  // Poll for verification status
  useEffect(() => {
    if (!targetEmail) return;

    if (shouldResumeOnboarding) {
      toast.success("Email verified successfully!");
      router.push("/onboarding");
      return;
    }

    if (isVerified && isOnboarded) {
      toast.success("Email verified successfully!");
      router.push("/dashboard");
      return;
    }

    const interval = setInterval(async () => {
      // Refresh session data to check for verification update
      const { data } = await authClient.getSession();
      if (!data?.user?.emailVerified) {
        return;
      }

      const onboarded = getOnboardedFlag(data.user);
      const canResumeOnboarding =
        !!window.sessionStorage.getItem("xenode-vault-pw") && !onboarded;

      if (canResumeOnboarding || onboarded) {
        toast.success("Email verified successfully!");
        router.push(onboarded ? "/dashboard" : "/onboarding");
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isOnboarded, isVerified, router, shouldResumeOnboarding, targetEmail]);

  const handleResend = async () => {
    if (!targetEmail) return;
    
    if (resendCount >= 5) {
      toast.error("You've requested too many verification emails. Please check your spam folder or wait a while.");
      return;
    }
    
    setIsResending(true);
    try {
      const { error } = await authClient.sendVerificationEmail({
        email: targetEmail,
        callbackURL: `${window.location.origin}/verify-email?verified=1`,
      });
      
      if (error) {
        toast.error(error.message || "Failed to resend email");
      } else {
        setResendCount(prev => prev + 1);
        toast.success("Verification email resent!");
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setIsResending(false);
    }
  };

  // If there's no session and no email param, user shouldn't be here
  useEffect(() => {
      if (!isPending) {
        if (!session && !emailParam) {
          router.push("/login");
        } else if (shouldResumeOnboarding) {
          router.push("/onboarding");
        } else if (isVerified && isOnboarded) {
          router.push("/dashboard");
        } else if (isVerified && !hasVaultBootstrap) {
          toast.info(
            "Email verified. Return to the tab where you signed up to finish secure vault setup, or sign in again if that tab is closed.",
          );
        }
      }
  }, [
    emailParam,
    hasVaultBootstrap,
    isOnboarded,
    isPending,
    isVerified,
    router,
    session,
    shouldResumeOnboarding,
  ]);

  if (isPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if ((!session && !emailParam) || shouldResumeOnboarding || (isVerified && isOnboarded)) {
    return null;
  }

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
          <div className="backdrop-blur-md bg-background/40 p-8 rounded-3xl border border-border/50 max-w-lg">
            <p className="text-base text-foreground/80 mb-3 font-medium tracking-wide uppercase">
              Secure your account
            </p>
            <h2 className="text-3xl font-semibold leading-tight text-foreground">
              Verification ensures only you have access to your data.
            </h2>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col justify-center px-8 sm:px-16 md:px-24 py-12 overflow-y-auto items-center">
        <div className="w-full max-w-md mx-auto space-y-8 text-center">
          <div className="lg:hidden mb-10">
            <Link href="/">
              <span className="text-4xl font-brand italic text-foreground">
                Xenode
              </span>
            </Link>
          </div>

          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-6">
            <Mail className="w-8 h-8 text-primary" />
          </div>

          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">
              {isVerified ? "Email verified" : "Check your email"}
            </h1>
            <p className="text-base text-muted-foreground">
              {isVerified ? (
                <>
                  Your email has been verified for{" "}
                  <span className="font-medium text-foreground">
                    {targetEmail}
                  </span>
                </>
              ) : (
                <>
                  We&apos;ve sent a verification link to{" "}
                  <span className="font-medium text-foreground">
                    {targetEmail}
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="bg-muted/50 rounded-2xl p-6 border border-border mt-8 text-left flex gap-4 items-start">
            <div className="mt-1">
              <CheckCircle2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-medium text-foreground">
                {isVerified ? "Continue in your original tab" : "Waiting for verification"}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {isVerified
                  ? "Vault setup depends on the password kept only in the tab where you signed up. If that tab is closed, sign in again to resume onboarding securely."
                  : "This page will automatically update once you click the link in your email."}
              </p>
            </div>
          </div>

          <div className="pt-8 space-y-4">
            {!isVerified ? (
              <Button
                variant="outline"
                onClick={handleResend}
                disabled={isResending}
                className="w-full h-12"
              >
                {isResending ? (
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                ) : null}
                Resend verification email
              </Button>
            ) : null}
            
            <p className="text-sm text-muted-foreground flex flex-col gap-2">
              {isVerified ? (
                <span>
                  Original tab closed?{" "}
                  <button
                    onClick={async () => {
                      if (session) {
                        await authClient.signOut();
                      }
                      router.push("/login");
                    }}
                    className="text-primary hover:underline font-medium"
                  >
                    Sign in again to resume onboarding
                  </button>
                </span>
              ) : (
                <span>
                  Verified on this device?{" "}
                  <button
                    onClick={() => {
                      router.refresh();
                    }}
                    className="text-primary hover:underline font-medium"
                  >
                    Refresh status
                  </button>
                </span>
              )}
              <span>
                Need to use a different email?{" "}
                <button
                  onClick={async () => {
                    if (session) {
                      await authClient.signOut();
                    }
                    router.push("/login");
                  }}
                  className="text-primary hover:underline font-medium"
                >
                  Sign out
                </button>
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}

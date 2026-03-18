"use client";

import { useEffect, useState, Suspense, lazy } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Mail, ArrowRight, Loader2, CheckCircle2 } from "lucide-react";
import { useSession, authClient } from "@/lib/auth/client";
import { toast } from "sonner";

const Dithering = lazy(() =>
  import("@paper-design/shaders-react").then((mod) => ({
    default: mod.Dithering,
  })),
);

export default function VerifyEmailPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [isResending, setIsResending] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Poll for verification status
  useEffect(() => {
    if (!session?.user) return;

    if (session.user.emailVerified) {
      toast.success("Email verified successfully!");
      router.push((session.user as any).onboarded ? "/dashboard" : "/onboarding");
      return;
    }

    const interval = setInterval(async () => {
      // Refresh session data to check for verification update
      const { data } = await authClient.getSession();
      if (data?.user?.emailVerified) {
        toast.success("Email verified successfully!");
        router.push((data.user as any).onboarded ? "/dashboard" : "/onboarding");
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [session, router]);

  const handleResend = async () => {
    if (!session?.user?.email) return;
    
    setIsResending(true);
    try {
      const { error } = await authClient.sendVerificationEmail({
        email: session.user.email,
        callbackURL: `${window.location.origin}/${(session.user as any).onboarded ? "dashboard" : "onboarding"}`,
      });
      
      if (error) {
        toast.error(error.message || "Failed to resend email");
      } else {
        toast.success("Verification email resent!");
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setIsResending(false);
    }
  };

  if (isPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // If there's no session, user shouldn't be here
  useEffect(() => {
    if (!isPending) {
      if (!session) {
        router.push("/login");
      } else if (session.user.emailVerified) {
        router.push((session.user as any).onboarded ? "/dashboard" : "/onboarding");
      }
    }
  }, [session, isPending, router]);

  if (!session || session.user.emailVerified) {
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
              Check your email
            </h1>
            <p className="text-base text-muted-foreground">
              We&apos;ve sent a verification link to{" "}
              <span className="font-medium text-foreground">
                {session.user.email}
              </span>
            </p>
          </div>

          <div className="bg-muted/50 rounded-2xl p-6 border border-border mt-8 text-left flex gap-4 items-start">
            <div className="mt-1">
              <CheckCircle2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-medium text-foreground">Waiting for verification</h3>
              <p className="text-sm text-muted-foreground mt-1">
                This page will automatically update once you click the link in your email.
              </p>
            </div>
          </div>

          <div className="pt-8 space-y-4">
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
            
            <p className="text-sm text-muted-foreground">
              Need to use a different email?{" "}
              <button
                onClick={async () => {
                  await authClient.signOut();
                  router.push("/login");
                }}
                className="text-primary hover:underline font-medium"
              >
                Sign out
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, Suspense, lazy, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Mail, Loader2 } from "lucide-react";
import { useSession, authClient } from "@/lib/auth/client";
import { toast } from "sonner";

const Dithering = lazy(() =>
  import("@paper-design/shaders-react").then((mod) => ({
    default: mod.Dithering,
  })),
);

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60;

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailParam = searchParams.get("email");
  const { data: session, isPending } = useSession();

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const hasSentRef = useRef(false);

  const targetEmail = emailParam || session?.user?.email || "";
  const isVerified = !!session?.user?.emailVerified;

  // Redirect already-verified users
  useEffect(() => {
    if (!isPending && isVerified) {
      const onboarded = (session?.user as { onboarded?: boolean } | undefined)?.onboarded;
      router.replace(onboarded ? "/dashboard" : "/onboarding");
    }
  }, [isPending, isVerified, router, session]);

  // Redirect if no email context
  useEffect(() => {
    if (!isPending && !targetEmail) {
      router.replace("/login");
    }
  }, [isPending, targetEmail, router]);

  // Send OTP once on mount
  useEffect(() => {
    if (!targetEmail || hasSentRef.current) return;
    hasSentRef.current = true;
    void sendOtp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetEmail]);

  // Cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const sendOtp = useCallback(async () => {
    if (!targetEmail || isSending) return;
    setIsSending(true);
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email: targetEmail,
        type: "email-verification",
      });
      if (error) {
        toast.error(error.message || "Failed to send code");
      } else {
        setCooldown(RESEND_COOLDOWN);
      }
    } catch {
      toast.error("Something went wrong sending the code");
    } finally {
      setIsSending(false);
    }
  }, [targetEmail, isSending]);

  const handleChange = (index: number, value: string) => {
    // Accept paste of full OTP
    if (value.length > 1) {
      const digits = value.replace(/\D/g, "").slice(0, OTP_LENGTH).split("");
      const next = [...otp];
      digits.forEach((d, i) => { next[i] = d; });
      setOtp(next);
      const focusIdx = Math.min(digits.length, OTP_LENGTH - 1);
      inputRefs.current[focusIdx]?.focus();
      return;
    }

    const digit = value.replace(/\D/g, "");
    const next = [...otp];
    next[index] = digit;
    setOtp(next);

    if (digit && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const code = otp.join("");
    if (code.length < OTP_LENGTH) {
      toast.error("Enter the full 6-digit code");
      return;
    }

    setIsVerifying(true);
    try {
      const { error } = await authClient.emailOtp.verifyEmail({
        email: targetEmail,
        otp: code,
      });

      if (error) {
        const msg = error.message || "Invalid code";
        if (msg.toLowerCase().includes("expired")) {
          toast.error("Code expired. Request a new one.");
        } else {
          toast.error(msg);
        }
        setOtp(Array(OTP_LENGTH).fill(""));
        inputRefs.current[0]?.focus();
        return;
      }

      toast.success("Email verified!");
      router.push("/onboarding");
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  if (isPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!targetEmail || isVerified) return null;

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Left panel */}
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
        <div className="w-full max-w-md mx-auto space-y-8">
          <div className="lg:hidden mb-10 text-center">
            <Link href="/">
              <span className="text-4xl font-brand italic text-foreground">
                Xenode
              </span>
            </Link>
          </div>

          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
            <Mail className="w-8 h-8 text-primary" />
          </div>

          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Check your email
            </h1>
            <p className="text-base text-muted-foreground">
              We sent a 6-digit code to{" "}
              <span className="font-medium text-foreground">{targetEmail}</span>
            </p>
          </div>

          {/* OTP input boxes */}
          <div className="flex gap-3 justify-center">
            {Array.from({ length: OTP_LENGTH }).map((_, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={OTP_LENGTH}
                value={otp[i] || ""}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onFocus={(e) => e.target.select()}
                className="w-12 h-14 text-center text-xl font-semibold border-2 rounded-lg bg-background text-foreground border-border focus:border-primary focus:outline-none transition-colors"
                autoComplete={i === 0 ? "one-time-code" : "off"}
              />
            ))}
          </div>

          <Button
            onClick={handleVerify}
            disabled={isVerifying || otp.join("").length < OTP_LENGTH}
            className="w-full h-12 text-base font-medium"
          >
            {isVerifying && <Loader2 className="w-5 h-5 animate-spin mr-2" />}
            Verify email
          </Button>

          <div className="text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Didn&apos;t receive the code?{" "}
              <button
                onClick={sendOtp}
                disabled={isSending || cooldown > 0}
                className="text-primary hover:underline font-medium disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
              >
                {isSending
                  ? "Sending…"
                  : cooldown > 0
                    ? `Resend in ${cooldown}s`
                    : "Resend code"}
              </button>
            </p>
            <p className="text-sm text-muted-foreground">
              Wrong account?{" "}
              <button
                onClick={async () => {
                  if (session) await authClient.signOut();
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

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}

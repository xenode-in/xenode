"use client";

import { useState, Suspense, lazy, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, signUp, authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { GradualSpacing } from "@/components/ui/gradual-spacing";
import { toast } from "sonner";

const Dithering = lazy(() =>
  import("@paper-design/shaders-react").then((mod) => ({
    default: mod.Dithering,
  })),
);

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");
  const [isLogin, setIsLogin] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  // Handle URL errors (like expired tokens)
  useEffect(() => {
    if (errorParam === "TOKEN_EXPIRED") {
      setError("Your verification link has expired. Please sign in to request a new one.");
    } else if (errorParam === "INVALID_TOKEN") {
      setError("Invalid verification link. Please sign in to request a new one.");
    }
  }, [errorParam]);

  const taglines = [
    "Your personal secure storage hub.",
    "End-to-end encrypted file sharing.",
    "Decentralized secure backups.",
  ];
  const [taglineIndex, setTaglineIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTaglineIndex((prev) => (prev + 1) % taglines.length);
    }, 10000);
    return () => clearInterval(interval);
  }, [taglines.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    if (!isLogin && formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    try {
      if (isLogin) {
        const result = await signIn.email({
          email: formData.email,
          password: formData.password,
        });
        if (result.error) {
          if (result.error.code === "EMAIL_NOT_VERIFIED" || result.error.message?.toLowerCase().includes("not verified")) {
            router.push(`/verify-email?email=${encodeURIComponent(formData.email)}`);
            return;
          }
          setError(result.error.message || "Invalid credentials");
          return;
        }
      } else {
        const sanitizedEmail = formData.email.trim().toLowerCase();
        
        const checkRes = await fetch(`/api/auth/check-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: sanitizedEmail })
        });
      
        if (checkRes.ok) {
          const { exists } = await checkRes.json();
          if (exists) {
            setError("An account with this email already exists.");
            return;
          }
        }

        const result = await signUp.email({
          name: formData.name.trim(),
          email: sanitizedEmail,
          password: formData.password,
          callbackURL: `${window.location.origin}/onboarding`, // Optional redirect after verification
        });
        if (result.error) {
          setError(result.error.message || "Failed to create account");
          return;
        }
      }

      sessionStorage.setItem("xenode-vault-pw", formData.password);
      
      // If logging in, check if verified. Otherwise, newly signed up users go to verify-email
      if (isLogin) {
        const { data } = await authClient.getSession();
        if (data?.user?.emailVerified === false) {
          router.push(`/verify-email?email=${encodeURIComponent(formData.email)}`);
        } else {
          router.push("/dashboard");
        }
      } else {
        router.push(`/verify-email?email=${encodeURIComponent(formData.email)}`);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
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
              colorBack="#00000000" // Transparent background
              colorFront="#7cb686" // Xenode green accent
              shape="warp"
              type="4x4"
              speed={isHovered ? 0.6 : 0.2}
              className="w-full h-full"
              minPixelRatio={1}
            />
          </div>
        </Suspense>

        <div className="relative z-10 p-12 h-full flex flex-col justify-between text-foreground">
          {/* Logo */}
          <Link href="/" className="inline-block">
            <span className="text-4xl font-brand italic text-foreground tracking-tight drop-shadow-sm">
              Xenode
            </span>
          </Link>

          {/* Bottom tagline */}
          <div className="backdrop-blur-md bg-background/40 p-8 rounded-3xl border border-border/50 max-w-lg min-h-[140px] flex flex-col justify-center">
            <p className="text-base text-foreground/80 mb-3 font-medium tracking-wide uppercase">
              Clarity and productivity
            </p>
            <div className="min-h-[4rem] flex items-center justify-start overflow-hidden">
              {/* Force re-render of GradualSpacing to restart animation on index change */}
              <GradualSpacing
                key={taglineIndex}
                text={taglines[taglineIndex]}
                className="text-3xl font-semibold leading-tight text-foreground text-left break-words"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col justify-center px-8 sm:px-16 md:px-24 lg:px-32 xl:px-40 py-12 overflow-y-auto">
        <div className="w-full max-w-md mx-auto space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden mb-10 text-center">
            <Link href="/">
              <span className="text-4xl font-brand italic text-foreground">
                Xenode
              </span>
            </Link>
          </div>

          <div className="space-y-2">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">
              {isLogin ? "Welcome back" : "Create an account"}
            </h1>
            <p className="text-base text-muted-foreground">
              {isLogin
                ? "Enter your details below to sign in to your account"
                : "Enter your details below to create your account"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {!isLogin && (
              <div className="space-y-3">
                <Label htmlFor="name" className="text-sm font-medium">
                  Full Name
                </Label>
                <Input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="John Doe"
                  className="h-12 bg-background border-input focus-visible:ring-primary/20 text-base"
                  required={!isLogin}
                />
              </div>
            )}

            <div className="space-y-3">
              <Label htmlFor="email" className="text-sm font-medium">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                placeholder="name@example.com"
                className="h-12 bg-background border-input focus-visible:ring-primary/20 text-base"
                required
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium">
                  Password
                </Label>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  placeholder="••••••••"
                  className="h-12 bg-background border-input focus-visible:ring-primary/20 pr-12 text-base"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            {!isLogin && (
              <div className="space-y-3">
                <Label
                  htmlFor="confirmPassword"
                  className="text-sm font-medium"
                >
                  Confirm Password
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      confirmPassword: e.target.value,
                    })
                  }
                  placeholder="••••••••"
                  className="h-12 bg-background border-input focus-visible:ring-primary/20 text-base"
                  required={!isLogin}
                  minLength={8}
                />
              </div>
            )}

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 font-medium">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-12 text-base font-medium transition-all hover:-translate-y-0.5 mt-2"
            >
              {isLoading && <Loader2 className="w-5 h-5 animate-spin mr-2" />}
              {isLogin ? "Sign In" : "Create Account"}
            </Button>
          </form>

          <p className="text-center text-base mt-8 text-muted-foreground">
            {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setError("");
              }}
              className="text-primary hover:underline font-semibold"
            >
              {isLogin ? "Sign up" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}

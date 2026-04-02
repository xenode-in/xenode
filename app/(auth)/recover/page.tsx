"use client";

import { useState, Suspense, lazy, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Loader2, 
  ArrowLeft, 
  KeyRound, 
  Lock, 
  CheckCircle2, 
  AlertCircle,
  Eye,
  EyeOff
} from "lucide-react";
import { toast } from "sonner";
import { recoverPassword } from "@/lib/crypto/forgotPassword";
import { deriveRecoveryKey } from "@/lib/crypto/recovery";
import { fromB64 } from "@/lib/crypto/utils";

const Dithering = lazy(() =>
  import("@paper-design/shaders-react").then((mod) => ({
    default: mod.Dithering,
  })),
);

type RecoveryStep = "IDENTIFY" | "KEYWORDS" | "RESET" | "SUCCESS";

export default function RecoveryPage() {
  const router = useRouter();
  const [step, setStep] = useState<RecoveryStep>("IDENTIFY");
  const [isHovered, setIsHovered] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  
  // Form State
  const [email, setEmail] = useState("");
  const [keywords, setKeywords] = useState<string[]>(new Array(12).fill(""));
  const [passwordData, setPasswordData] = useState({
    newPassword: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);

  // Recovery Metadata (from Bootstrap)
  const [recoveryMetadata, setRecoveryMetadata] = useState<{
    userId: string;
    recoverySaltB64: string;
    recoveryWordIvB64: string;
    encryptedPrivateKeyB64: string;
  } | null>(null);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Handle pasting keywords (e.g. from the recovery kit file)
  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const data = e.clipboardData.getData("text").trim();
    // Split by whitespace or newlines
    const words = data.split(/[\s\n]+/).slice(0, 12);
    
    const newKeywords = [...keywords];
    words.forEach((word, idx) => {
      newKeywords[idx] = word.toLowerCase();
    });
    setKeywords(newKeywords);
    
    // Focus the next empty input or the last one
    const nextIdx = Math.min(words.length, 11);
    inputRefs.current[nextIdx]?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (index < 11) {
        inputRefs.current[index + 1]?.focus();
      } else {
        handleVerifyKeywords(e as any);
      }
    } else if (e.key === "Backspace" && !keywords[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  /**
   * STEP 1: Bootstrap Recovery
   */
  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/recovery/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No recovery vault found for this email.");
        return;
      }

      setRecoveryMetadata(data);
      setStep("KEYWORDS");
    } catch (err) {
      setError("Failed to verify email. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * STEP 2: Verify Keywords & Step to Reset
   */
  const handleVerifyKeywords = async (e: React.FormEvent) => {
    e.preventDefault();
    if (keywords.some(k => !k.trim())) {
      setError("Please fill in all 12 keywords.");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      if (!recoveryMetadata) throw new Error("Missing recovery metadata");

      // Verify keywords by attempting to derive the key and decrypt vault
      const recoveryKey = await deriveRecoveryKey(
        keywords.map(k => k.trim().toLowerCase()),
        recoveryMetadata.recoverySaltB64
      );

      const iv = fromB64(recoveryMetadata.recoveryWordIvB64);
      const ciphertext = fromB64(recoveryMetadata.encryptedPrivateKeyB64);

      // Attempt decryption - if it fails, it throws OperationError
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        recoveryKey,
        ciphertext
      );

      // Success!
      setStep("RESET");
    } catch (err) {
      console.error("Keyword verification failed:", err);
      setError("Invalid recovery keywords. Please check and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * STEP 3: Complete Recovery & Atomic Update
   */
  const handleCompleteRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (passwordData.newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      if (!recoveryMetadata) throw new Error("Missing recovery metadata");

      // 1. Perform Client-Side Crypto (Recover & Re-encrypt)
      const recoveryResult = await recoverPassword({
        recoveryKeywords: keywords.map(k => k.trim().toLowerCase()),
        recoverySaltB64: recoveryMetadata.recoverySaltB64,
        recoveryWordIvB64: recoveryMetadata.recoveryWordIvB64,
        encryptedPrivateKeyB64: recoveryMetadata.encryptedPrivateKeyB64,
        newPassword: passwordData.newPassword,
      });

      // 2. Submit to Server
      const res = await fetch("/api/auth/recovery/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: recoveryMetadata.userId,
          newPassword: passwordData.newPassword, // Pass to sync with login
          ...recoveryResult,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to complete recovery.");
      }

      // 3. Stage the password for auto-unlock once they land on the dashboard
      if (typeof window !== "undefined") {
        sessionStorage.setItem("xenode-vault-pw", passwordData.newPassword);
      }

      setStep("SUCCESS");
      toast.success("Account successfully recovered!");
    } catch (err: any) {
      console.error("Recovery error:", err);
      setError(err.message || "Invalid recovery keywords or vault error.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden font-sans">
      {/* Left panel - Branding & Shader */}
      <div 
        className="hidden lg:flex lg:w-1/3 relative flex-col justify-between overflow-hidden border-r border-border bg-card"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Suspense fallback={<div className="absolute inset-0 bg-muted" />}>
           <div className="absolute inset-0 z-0 opacity-80 dark:opacity-60 mix-blend-multiply dark:mix-blend-screen">
            <Dithering
              colorBack="#00000000"
              colorFront="#7cb686"
              shape="warp"
              type="4x4"
              speed={isHovered ? 0.6 : 0.2}
              className="w-full h-full"
            />
          </div>
        </Suspense>

        <div className="relative z-10 p-10 h-full flex flex-col justify-between">
          <Link href="/" className="inline-block">
             <span className="text-3xl font-brand italic text-foreground tracking-tight">
               Xenode
             </span>
          </Link>

          <div className="space-y-4">
            <h2 className="text-2xl font-semibold text-foreground leading-tight">
              Vault Recovery
            </h2>
            <p className="text-muted-foreground text-sm max-w-xs leading-relaxed">
              Your data is secured with zero-knowledge encryption. Use your 12 keywords to safely regain access to your vault.
            </p>
          </div>
        </div>
      </div>

      {/* Right panel - Dynamic Flow */}
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 md:px-20 py-12 overflow-y-auto">
        <div className="w-full max-w-md mx-auto">
          
          <AnimatePresence mode="wait">
            {step === "IDENTIFY" && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="space-y-2">
                  <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                    Lost your password?
                  </h1>
                  <p className="text-muted-foreground text-base">
                    Enter your email to begin the zero-knowledge recovery process.
                  </p>
                </div>

                <form onSubmit={handleBootstrap} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Email Address
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-12 bg-background border-input"
                      required
                    />
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">
                      <AlertCircle className="w-4 h-4" />
                      {error}
                    </div>
                  )}

                  <Button type="submit" disabled={isLoading} className="w-full h-12">
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : "Continue"}
                  </Button>
                </form>

                <div className="pt-4">
                  <Link href="/login" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors group">
                    <ArrowLeft className="w-4 h-4 mr-2 transition-transform group-hover:-translate-x-1" />
                    Back to login
                  </Link>
                </div>
              </motion.div>
            )}

            {step === "KEYWORDS" && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="space-y-2">
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center mb-4 text-primary">
                    <KeyRound className="w-5 h-5" />
                  </div>
                  <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                    Recovery Keywords
                  </h1>
                  <p className="text-muted-foreground text-base">
                    Enter your 12 recovery keywords in the correct order to unlock your vault.
                  </p>
                </div>

                <form onSubmit={handleVerifyKeywords} className="space-y-6">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" onPaste={handlePaste}>
                    {keywords.map((word, i) => (
                      <div key={i} className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground select-none">
                          {i + 1}
                        </span>
                        <Input
                          ref={(el) => (inputRefs.current[i] = el)}
                          value={word}
                          onChange={(e) => {
                            const newWords = [...keywords];
                            newWords[i] = e.target.value;
                            setKeywords(newWords);
                          }}
                          onKeyDown={(e) => handleKeyDown(e, i)}
                          className="h-10 pl-7 text-sm bg-background/50 border-input font-medium"
                          placeholder="word"
                          required
                          autoComplete="off"
                        />
                      </div>
                    ))}
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">
                      <AlertCircle className="w-4 h-4" />
                      {error}
                    </div>
                  )}

                  <div className="flex gap-3">
                    <Button type="button" variant="ghost" onClick={() => setStep("IDENTIFY")} className="h-12 w-24">
                      Back
                    </Button>
                    <Button type="submit" className="w-full h-12">
                      Unlock Vault
                    </Button>
                  </div>
                </form>
              </motion.div>
            )}

            {step === "RESET" && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="space-y-2">
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center mb-4 text-primary">
                    <Lock className="w-5 h-5" />
                  </div>
                  <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                    Set New Password
                  </h1>
                  <p className="text-muted-foreground text-base">
                    Vault unlocked! Set a new master password for your account.
                  </p>
                </div>

                <form onSubmit={handleCompleteRecovery} className="space-y-4">
                  <div className="space-y-3">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      New Master Password
                    </Label>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        value={passwordData.newPassword}
                        onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                        className="h-12 bg-background border-input pr-12"
                        placeholder="••••••••"
                        required
                        minLength={8}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Confirm New Password
                    </Label>
                    <Input
                      type="password"
                      value={passwordData.confirmPassword}
                      onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                      className="h-12 bg-background border-input"
                      placeholder="••••••••"
                      required
                    />
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">
                      <AlertCircle className="w-4 h-4" />
                      {error}
                    </div>
                  )}

                  <Button type="submit" disabled={isLoading} className="w-full h-12">
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : "Recover Account"}
                  </Button>
                </form>
              </motion.div>
            )}

            {step === "SUCCESS" && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center space-y-6 py-8"
              >
                <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto text-green-500">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                
                <div className="space-y-2">
                  <h1 className="text-3xl font-semibold tracking-tight text-foreground leading-tight">
                    Vault Recovered Successfully
                  </h1>
                  <p className="text-muted-foreground text-base">
                    Your password has been reset and all other sessions have been logged out for security.
                  </p>
                </div>

                <div className="pt-4">
                  <Button onClick={() => router.push("/login")} className="w-full h-12">
                    Proceed to Login
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>
    </div>
  );
}

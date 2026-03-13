"use client";

import { useTransition, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type SubmitHandler, type UseFormReturn } from "react-hook-form";
import * as z from "zod";
import { authClient, useSession } from "@/lib/auth/client";
import { useCrypto } from "@/contexts/CryptoContext";
import {
  generateRecoveryKit,
  formatRecoveryKitDownload,
} from "@/lib/crypto/recovery";
import {
  Moon,
  Sun,
  Monitor,
  Shield,
  ArrowRight,
  ExternalLink,
  ChevronLeft,
  CheckCircle2,
  KeyRound,
  ShieldCheck,
  Copy,
  Download,
  AlertTriangle,
  Eye,
  EyeOff,
  HardDrive,
  Lock,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { WelcomeBalloons } from "@/components/onboarding/WelcomeBalloons";
import { PersonalSettings } from "@/components/onboarding/PersonalSettings";
import { WellDone } from "@/components/onboarding/WellDone";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

// No plan selection at onboarding — everyone starts on the free tier.
// Paid plans (100GB, 500GB, 1TB, 2TB) are purchased from the dashboard.
const onboardingSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  encryptByDefault: z.boolean(),
});

type OnboardingValues = z.infer<typeof onboardingSchema>;

export function OnboardingForm() {
  const router = useRouter();
  const { setTheme, theme } = useTheme();
  const { setup } = useCrypto();
  const { data: session } = useSession();
  const [isPending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);

  // Steps:
  // 1 = Welcome
  // 2 = Vault Password Setup
  // 3 = Save Recovery Kit
  // 4 = Preferences (theme + encryption toggle)
  // 5 = Well Done
  const totalSteps = 5;
  const [step, setStep] = useState(1);

  // ─── Step 2: vault password ───
  const [kit] = useState(() => generateRecoveryKit());
  const [vaultPassword, setVaultPassword] = useState("");
  const [vaultConfirm, setVaultConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwError, setPwError] = useState("");

  // ─── Step 3: recovery kit ───
  const [kitSaved, setKitSaved] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const form = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      theme: (theme as "light" | "dark" | "system") || "system",
      encryptByDefault: false,
    },
  }) as UseFormReturn<OnboardingValues>;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(kit.words.join(" "));
    toast.success("Recovery kit copied");
  }, [kit]);

  const handleDownload = useCallback(() => {
    const text = formatRecoveryKitDownload(kit.words);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    const userName = session?.user?.name || "user";
    const sanitizedName = userName
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");

    a.download = `xenode-recovery-kit-${sanitizedName}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Recovery kit downloaded");
  }, [kit, session]);

  function handlePasswordNext() {
    setPwError("");
    if (vaultPassword.length < 8) {
      setPwError("Password must be at least 8 characters.");
      return;
    }
    if (vaultPassword !== vaultConfirm) {
      setPwError("Passwords don't match.");
      return;
    }
    setStep(3);
  }

  const nextStep = () => {
    if (step < totalSteps) setStep(step + 1);
  };
  const prevStep = () => {
    if (step > 1) setStep(step - 1);
  };

  const onSubmit: SubmitHandler<OnboardingValues> = async (data) => {
    if (step !== totalSteps) {
      nextStep();
      return;
    }

    startTransition(async () => {
      try {
        // 1. Apply theme
        setTheme(data.theme);

        // 2. Setup the vault (master password + recovery kit)
        await setup(vaultPassword, kit.passphrase);

        // 3. Mark user as onboarded + save encrypt-by-default preference
        const result = await authClient.updateUser({
          // @ts-expect-error additionalFields
          onboarded: true,
          encryptByDefault: data.encryptByDefault,
        });

        if (result.error) {
          throw new Error(result.error.message || "Failed to save preferences");
        }

        // 4. Create Usage document — always free tier, 5 GB.
        //    Paid plans are purchased from the dashboard via /checkout.
        const usageRes = await fetch("/api/onboarding/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        if (!usageRes.ok) {
          const err = await usageRes.json().catch(() => ({}));
          throw new Error(err?.error || "Failed to initialise storage quota");
        }

        toast.success("All set! Welcome to Xenode.");
        router.push("/dashboard");
        router.refresh();
      } catch (error) {
        toast.error("Something went wrong. Please try again.");
        console.error(error);
      }
    });
  }

  if (!mounted) return null;

  const slideVariants = {
    hidden: { opacity: 0, x: 20 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, x: -20, transition: { duration: 0.2 } },
  };

  return (
    <Card className="border-none shadow-none md:border-solid md:shadow-md bg-transparent md:bg-card">
      <CardContent className="pt-6">
        {/* Progress bar */}
        <div className="flex justify-between items-center mb-6">
          {step > 1 && step < totalSteps ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={prevStep}
              className="-ml-2"
            >
              <ChevronLeft className="mr-2 h-4 w-4" /> Back
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-1">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`h-2 w-8 rounded-full transition-colors ${
                  step >= i + 1 ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="overflow-hidden min-h-[400px]">
              <AnimatePresence mode="wait">
                {/* ───── STEP 1: Welcome ───── */}
                {step === 1 && (
                  <motion.div
                    key="step1"
                    variants={slideVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="flex flex-col items-center text-center space-y-6"
                  >
                    <WelcomeBalloons className="h-64 w-auto drop-shadow-sm" />
                    <div className="space-y-2">
                      <h2 className="text-3xl font-bold tracking-tight">
                        Welcome into Xenode!
                      </h2>
                      <p className="text-muted-foreground px-4 text-balance">
                        We're thrilled to have you. Let's get your account
                        personalized and set up perfectly for your needs in just
                        a few clicks.
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* ───── STEP 2: Vault Master Password ───── */}
                {step === 2 && (
                  <motion.div
                    key="step2"
                    variants={slideVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="space-y-5"
                  >
                    <div className="flex flex-col items-center text-center space-y-2">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                        <KeyRound className="h-7 w-7 text-primary" />
                      </div>
                      <h2 className="text-2xl font-bold">
                        Create your master password
                      </h2>
                      <p className="text-muted-foreground text-sm max-w-sm">
                        This password encrypts your files. It never leaves your
                        device. Choose something strong — you'll need it on
                        every new device.
                      </p>
                    </div>

                    <div className="space-y-4 max-w-sm mx-auto">
                      <div className="space-y-2">
                        <Label htmlFor="ob-vault-pw">Master password</Label>
                        <div className="relative">
                          <Input
                            id="ob-vault-pw"
                            type={showPw ? "text" : "password"}
                            value={vaultPassword}
                            onChange={(e) => setVaultPassword(e.target.value)}
                            placeholder="At least 8 characters"
                            autoComplete="new-password"
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
                      <div className="space-y-2">
                        <Label htmlFor="ob-vault-confirm">
                          Confirm password
                        </Label>
                        <Input
                          id="ob-vault-confirm"
                          type={showPw ? "text" : "password"}
                          value={vaultConfirm}
                          onChange={(e) => setVaultConfirm(e.target.value)}
                          placeholder="Repeat your password"
                          autoComplete="new-password"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handlePasswordNext();
                          }}
                        />
                      </div>
                      {pwError && (
                        <p className="text-sm text-destructive">{pwError}</p>
                      )}

                      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground space-y-1">
                        <p className="font-medium text-foreground text-sm">
                          Why a separate password?
                        </p>
                        <p>
                          Your login (Google, GitHub, or email) is separate from
                          your vault. This ensures even Xenode can't read your
                          files.
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* ───── STEP 3: Recovery Kit ───── */}
                {step === 3 && (
                  <motion.div
                    key="step3"
                    variants={slideVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="space-y-4"
                  >
                    <div className="flex flex-col items-center text-center space-y-2">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                        <ShieldCheck className="h-7 w-7 text-primary" />
                      </div>
                      <h2 className="text-2xl font-bold">
                        Save your Recovery Kit
                      </h2>
                      <p className="text-muted-foreground text-sm max-w-sm">
                        If you ever forget your master password, these 12 words
                        are your only backup. Store them somewhere safe —
                        offline is best.
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {kit.words.map((word, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2"
                        >
                          <span className="text-xs text-muted-foreground w-4 shrink-0">
                            {i + 1}.
                          </span>
                          <span className="text-sm font-medium">{word}</span>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1"
                        onClick={handleCopy}
                      >
                        <Copy className="mr-2 h-4 w-4" /> Copy
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1"
                        onClick={handleDownload}
                      >
                        <Download className="mr-2 h-4 w-4" /> Download
                      </Button>
                    </div>

                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        These words only work with your master password. Neither
                        alone unlocks your vault.
                      </p>
                    </div>

                    <label className="flex items-center gap-3 cursor-pointer select-none">
                      <div
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                          kitSaved
                            ? "border-primary bg-primary"
                            : "border-border bg-transparent"
                        }`}
                        onClick={() => setKitSaved((v) => !v)}
                      >
                        {kitSaved && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-primary-foreground" />
                        )}
                      </div>
                      <span className="text-sm">
                        I've saved my recovery kit in a safe place
                      </span>
                    </label>
                  </motion.div>
                )}

                {/* ───── STEP 4: Preferences ───── */}
                {step === 4 && (
                  <motion.div
                    key="step4"
                    variants={slideVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="space-y-6"
                  >
                    <div className="text-center space-y-2">
                      <PersonalSettings className="h-48 w-auto mx-auto drop-shadow-sm" />
                      <h2 className="text-2xl font-bold">Preferences</h2>
                      <p className="text-muted-foreground">
                        Customize your working environment
                      </p>
                    </div>

                    <div className="space-y-6 max-w-lg mx-auto">
                      {/* Free tier info card — no plan picker */}
                      <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-lg">
                            Starter — Free forever
                          </span>
                          <CheckCircle2 className="h-5 w-5 text-primary" />
                        </div>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                          <li className="flex items-center gap-2">
                            <HardDrive className="h-4 w-4 text-primary shrink-0" />
                            5 GB encrypted storage
                          </li>
                          <li className="flex items-center gap-2">
                            <Lock className="h-4 w-4 text-primary shrink-0" />
                            End-to-end encryption
                          </li>
                          <li className="flex items-center gap-2">
                            <Zap className="h-4 w-4 text-primary shrink-0" />
                            Upgrade anytime from the dashboard
                          </li>
                        </ul>
                      </div>

                      {/* Theme picker */}
                      <FormField
                        control={form.control}
                        name="theme"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel className="font-semibold">
                              Appearance
                            </FormLabel>
                            <FormControl>
                              <RadioGroup
                                onValueChange={(val) => {
                                  field.onChange(val);
                                  setTheme(val);
                                }}
                                defaultValue={field.value}
                                className="grid grid-cols-3 gap-4"
                              >
                                {(["light", "dark", "system"] as const).map(
                                  (val) => (
                                    <FormItem key={val}>
                                      <FormLabel className="[&:has([data-state=checked])>div]:border-primary cursor-pointer transition-all">
                                        <FormControl>
                                          <RadioGroupItem
                                            value={val}
                                            className="sr-only"
                                          />
                                        </FormControl>
                                        <div className="items-center rounded-xl border-2 border-muted bg-popover p-1 hover:bg-accent">
                                          <div
                                            className={`space-y-2 rounded-sm p-2 ${
                                              val === "dark"
                                                ? "bg-slate-950"
                                                : val === "light"
                                                  ? "bg-[#ecedef]"
                                                  : "bg-[#ecedef] dark:bg-slate-950"
                                            }`}
                                          >
                                            <div
                                              className={`space-y-2 rounded-md p-2 shadow-sm ${
                                                val === "dark"
                                                  ? "bg-slate-800"
                                                  : val === "light"
                                                    ? "bg-white"
                                                    : "bg-white dark:bg-slate-800"
                                              }`}
                                            >
                                              <div
                                                className={`h-2 w-full rounded-lg ${
                                                  val === "dark"
                                                    ? "bg-slate-400"
                                                    : val === "light"
                                                      ? "bg-[#ecedef]"
                                                      : "bg-[#ecedef] dark:bg-slate-400"
                                                }`}
                                              />
                                            </div>
                                            <div
                                              className={`flex items-center space-x-2 rounded-md p-2 shadow-sm ${
                                                val === "dark"
                                                  ? "bg-slate-800"
                                                  : val === "light"
                                                    ? "bg-white"
                                                    : "bg-white dark:bg-slate-800"
                                              }`}
                                            >
                                              {val === "light" && (
                                                <Sun className="h-4 w-4 text-muted-foreground" />
                                              )}
                                              {val === "dark" && (
                                                <Moon className="h-4 w-4 text-slate-400" />
                                              )}
                                              {val === "system" && (
                                                <Monitor className="h-4 w-4 text-muted-foreground dark:text-slate-400" />
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                        <span className="block w-full pt-2 text-center text-sm font-medium capitalize">
                                          {val}
                                        </span>
                                      </FormLabel>
                                    </FormItem>
                                  ),
                                )}
                              </RadioGroup>
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      {/* Encrypt by default toggle */}
                      <FormField
                        control={form.control}
                        name="encryptByDefault"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-xl border-2 p-4">
                            <div className="space-y-1 mr-4">
                              <div className="flex items-center gap-2">
                                <Shield className="h-4 w-4 text-primary" />
                                <FormLabel className="text-base font-semibold">
                                  Encrypt files by default
                                </FormLabel>
                              </div>
                              <FormDescription className="text-sm leading-snug">
                                Encrypt files in the browser before upload.
                              </FormDescription>
                              <a
                                href="/blog/encryption-pros-cons"
                                target="_blank"
                                className="inline-flex mt-1 items-center gap-1 text-xs font-medium text-primary hover:underline"
                              >
                                Read trade-offs{" "}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                  </motion.div>
                )}

                {/* ───── STEP 5: Well Done ───── */}
                {step === 5 && (
                  <motion.div
                    key="step5"
                    variants={slideVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="flex flex-col items-center text-center space-y-6 py-6"
                  >
                    <WellDone className="h-64 w-auto drop-shadow-sm" />
                    <div className="space-y-2">
                      <h2 className="text-3xl font-bold">You're All Set!</h2>
                      <p className="text-muted-foreground">
                        Your vault is protected and your workspace is ready.
                        Let's start uploading and sharing files securely.
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer buttons */}
            <div className="pt-4 border-t w-full flex justify-end">
              {step === 2 && (
                <Button
                  type="button"
                  size="lg"
                  onClick={handlePasswordNext}
                  disabled={!vaultPassword || !vaultConfirm}
                  className="w-full sm:w-auto min-w-[120px]"
                >
                  Continue <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
              {step === 3 && (
                <Button
                  type="button"
                  size="lg"
                  onClick={nextStep}
                  disabled={!kitSaved}
                  className="w-full sm:w-auto min-w-[120px]"
                >
                  Continue <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
              {step !== 2 && step !== 3 && step < totalSteps && (
                <Button
                  type="button"
                  size="lg"
                  onClick={nextStep}
                  className="w-full sm:w-auto min-w-[120px]"
                >
                  Continue <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
              {step === totalSteps && (
                <Button
                  type="submit"
                  size="lg"
                  disabled={isPending}
                  className="w-full sm:w-auto min-w-[150px]"
                >
                  {isPending ? "Setting up..." : "Go to Dashboard"}
                  {!isPending && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

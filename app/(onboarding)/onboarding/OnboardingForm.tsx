"use client";

import { useTransition, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { authClient } from "@/lib/auth/client";
import {
  Moon,
  Sun,
  Monitor,
  Shield,
  ArrowRight,
  ExternalLink,
  ChevronLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Fingerprint,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { WelcomeBalloons } from "@/components/onboarding/WelcomeBalloons";
import { ChoosePlan } from "@/components/onboarding/ChoosePlan";
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
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { toast } from "sonner";
import { setupUserKeyVault } from "@/lib/crypto/keySetup";
import { cacheKeys } from "@/lib/crypto/keyCache";

const onboardingSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  encryptByDefault: z.boolean().default(false),
  plan: z.enum(["free", "pro"]).default("free"),
});

type OnboardingValues = z.infer<typeof onboardingSchema>;

export function OnboardingForm() {
  const router = useRouter();
  const { setTheme, theme } = useTheme();
  const [isPending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(1);
  const totalSteps = 5; // 1:Welcome 2:Plan 3:Preferences 4:Security 5:WellDone

  // Security step state
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [passkeyRegistered, setPasskeyRegistered] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [securityDone, setSecurityDone] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const form = useForm({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      theme: (theme as "light" | "dark" | "system") || "system",
      encryptByDefault: false,
      plan: "free",
    },
  });

  const nextStep = () => {
    if (step < totalSteps) setStep(step + 1);
  };

  const prevStep = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleRegisterPasskey = async () => {
    setPasskeyLoading(true);
    try {
      // @ts-expect-error passkey plugin types may not be inferred on base client
      await authClient.passkey.addPasskey();
      setPasskeyRegistered(true);
      toast.success("Passkey registered! You can now log in without a password.");
    } catch {
      toast.error("Passkey registration failed. You can skip and add one later.");
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleSetupVault = async () => {
    if (passphrase.length < 8) {
      toast.error("Passphrase must be at least 8 characters.");
      return;
    }
    if (passphrase !== passphraseConfirm) {
      toast.error("Passphrases do not match.");
      return;
    }
    setVaultLoading(true);
    try {
      const session = await authClient.getSession();
      const userId = session?.data?.user?.id;
      if (!userId) throw new Error("Not authenticated");

      const keys = await setupUserKeyVault(passphrase);
      await cacheKeys(userId, keys.privateKey, keys.publicKey);
      setSecurityDone(true);
      toast.success("Encryption vault created! Your files are now E2EE protected.");
    } catch {
      toast.error("Failed to create vault. Please try again.");
    } finally {
      setVaultLoading(false);
    }
  };

  async function onSubmit(data: OnboardingValues) {
    // Steps 1-4: just advance
    if (step < totalSteps) {
      nextStep();
      return;
    }

    // Step 5 (final): save preferences and redirect
    startTransition(async () => {
      try {
        setTheme(data.theme);

        const result = await authClient.updateUser({
          // @ts-expect-error additionalFields not strictly typed yet
          onboarded: true,
          encryptByDefault: data.encryptByDefault,
        });

        if (result.error) {
          throw new Error(result.error.message || "Failed to save preferences");
        }

        toast.success("Preferences saved successfully!");
        router.push("/dashboard");
        router.refresh();
      } catch (error) {
        toast.error("Something went wrong. Please try again.");
        console.error(error);
      }
    });
  }

  if (!mounted) {
    return null;
  }

  const slideVariants = {
    hidden: { opacity: 0, x: 20 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, x: -20, transition: { duration: 0.2 } },
  };

  // On step 4, the Continue button is replaced by inline actions
  const isSecurityStep = step === 4;

  return (
    <Card className="border-none shadow-none md:border-solid md:shadow-md bg-transparent md:bg-card">
      <CardContent className="pt-6">
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
                {/* ── Step 1: Welcome ── */}
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
                        We&apos;re thrilled to have you. Let&apos;s get your account
                        personalized and set up perfectly for your needs in just
                        a few clicks.
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* ── Step 2: Choose Plan ── */}
                {step === 2 && (
                  <motion.div
                    key="step2"
                    variants={slideVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="space-y-6"
                  >
                    <div className="text-center space-y-2">
                      <ChoosePlan className="h-48 w-auto mx-auto drop-shadow-sm" />
                      <h2 className="text-2xl font-bold">Choose your plan</h2>
                      <p className="text-muted-foreground">
                        You can change this anytime later.
                      </p>
                    </div>

                    <FormField
                      control={form.control}
                      name="plan"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <RadioGroup
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                              className="grid md:grid-cols-2 gap-4"
                            >
                              <FormItem>
                                <FormLabel className="[&:has([data-state=checked])>div]:border-primary [&:has([data-state=checked])>div]:bg-primary/5 cursor-pointer">
                                  <FormControl>
                                    <RadioGroupItem
                                      value="free"
                                      className="sr-only"
                                    />
                                  </FormControl>
                                  <div className="rounded-xl border-2 p-4 transition-all hover:bg-muted">
                                    <div className="flex justify-between items-center mb-2">
                                      <span className="font-semibold text-lg">Starter</span>
                                      {field.value === "free" && (
                                        <CheckCircle2 className="h-5 w-5 text-primary" />
                                      )}
                                    </div>
                                    <div className="text-2xl font-bold mb-1">
                                      ₹0
                                      <span className="text-sm font-normal text-muted-foreground">/mo</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground">Perfect for trying things out.</p>
                                    <ul className="mt-4 space-y-2 text-sm">
                                      <li className="flex items-center gap-2">
                                        <div className="h-1.5 w-1.5 rounded-full bg-primary" /> 5 GB Storage
                                      </li>
                                      <li className="flex items-center gap-2">
                                        <div className="h-1.5 w-1.5 rounded-full bg-primary" /> Community Support
                                      </li>
                                    </ul>
                                  </div>
                                </FormLabel>
                              </FormItem>
                              <FormItem>
                                <FormLabel className="[&:has([data-state=checked])>div]:border-primary [&:has([data-state=checked])>div]:bg-primary/5 cursor-pointer">
                                  <FormControl>
                                    <RadioGroupItem
                                      value="pro"
                                      className="sr-only"
                                    />
                                  </FormControl>
                                  <div className="rounded-xl border-2 p-4 transition-all hover:bg-muted">
                                    <div className="flex justify-between items-center mb-2">
                                      <span className="font-semibold text-lg">Pro Builder</span>
                                      {field.value === "pro" && (
                                        <CheckCircle2 className="h-5 w-5 text-primary" />
                                      )}
                                    </div>
                                    <div className="text-2xl font-bold mb-1">
                                      ₹1.5
                                      <span className="text-sm font-normal text-muted-foreground">/GB</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground">For scaling applications.</p>
                                    <ul className="mt-4 space-y-2 text-sm">
                                      <li className="flex items-center gap-2">
                                        <div className="h-1.5 w-1.5 rounded-full bg-primary" /> Unlimited Storage
                                      </li>
                                      <li className="flex items-center gap-2">
                                        <div className="h-1.5 w-1.5 rounded-full bg-primary" /> Priority Support
                                      </li>
                                    </ul>
                                  </div>
                                </FormLabel>
                              </FormItem>
                            </RadioGroup>
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </motion.div>
                )}

                {/* ── Step 3: Preferences ── */}
                {step === 3 && (
                  <motion.div
                    key="step3"
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
                      <FormField
                        control={form.control}
                        name="theme"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel className="font-semibold">Appearance</FormLabel>
                            <FormControl>
                              <RadioGroup
                                onValueChange={(val: string) => {
                                  field.onChange(val);
                                  setTheme(val);
                                }}
                                defaultValue={field.value}
                                className="grid grid-cols-3 gap-4"
                              >
                                <FormItem>
                                  <FormLabel className="[&:has([data-state=checked])>div]:border-primary cursor-pointer transition-all">
                                    <FormControl>
                                      <RadioGroupItem value="light" className="sr-only" />
                                    </FormControl>
                                    <div className="items-center rounded-xl border-2 border-muted bg-popover p-1 hover:bg-accent hover:text-accent-foreground">
                                      <div className="space-y-2 rounded-sm bg-[#ecedef] p-2">
                                        <div className="space-y-2 rounded-md bg-white p-2 shadow-sm">
                                          <div className="h-2 w-full rounded-lg bg-[#ecedef]" />
                                          <div className="h-2 w-3/4 rounded-lg bg-[#ecedef]" />
                                        </div>
                                        <div className="flex items-center space-x-2 rounded-md bg-white p-2 shadow-sm">
                                          <Sun className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                      </div>
                                    </div>
                                    <span className="block w-full pt-2 text-center text-sm font-medium">Light</span>
                                  </FormLabel>
                                </FormItem>
                                <FormItem>
                                  <FormLabel className="[&:has([data-state=checked])>div]:border-primary cursor-pointer transition-all">
                                    <FormControl>
                                      <RadioGroupItem value="dark" className="sr-only" />
                                    </FormControl>
                                    <div className="items-center rounded-xl border-2 border-muted bg-popover p-1 hover:bg-accent hover:text-accent-foreground">
                                      <div className="space-y-2 rounded-sm bg-slate-950 p-2">
                                        <div className="space-y-2 rounded-md bg-slate-800 p-2 shadow-sm">
                                          <div className="h-2 w-full rounded-lg bg-slate-400" />
                                          <div className="h-2 w-3/4 rounded-lg bg-slate-400" />
                                        </div>
                                        <div className="flex items-center space-x-2 rounded-md bg-slate-800 p-2 shadow-sm">
                                          <Moon className="h-4 w-4 text-slate-400" />
                                        </div>
                                      </div>
                                    </div>
                                    <span className="block w-full pt-2 text-center text-sm font-medium">Dark</span>
                                  </FormLabel>
                                </FormItem>
                                <FormItem>
                                  <FormLabel className="[&:has([data-state=checked])>div]:border-primary cursor-pointer transition-all">
                                    <FormControl>
                                      <RadioGroupItem value="system" className="sr-only" />
                                    </FormControl>
                                    <div className="items-center rounded-xl border-2 border-muted bg-popover p-1 hover:bg-accent hover:text-accent-foreground">
                                      <div className="space-y-2 rounded-sm bg-[#ecedef] dark:bg-slate-950 p-2">
                                        <div className="space-y-2 rounded-md bg-white dark:bg-slate-800 p-2 shadow-sm">
                                          <div className="h-2 w-full rounded-lg bg-[#ecedef] dark:bg-slate-400" />
                                          <div className="h-2 w-3/4 rounded-lg bg-[#ecedef] dark:bg-slate-400" />
                                        </div>
                                        <div className="flex items-center space-x-2 rounded-md bg-white dark:bg-slate-800 p-2 shadow-sm">
                                          <Monitor className="h-4 w-4 text-muted-foreground dark:text-slate-400" />
                                        </div>
                                      </div>
                                    </div>
                                    <span className="block w-full pt-2 text-center text-sm font-medium">System</span>
                                  </FormLabel>
                                </FormItem>
                              </RadioGroup>
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="encryptByDefault"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-xl border-2 p-4">
                            <div className="space-y-1 mr-4">
                              <div className="flex items-center gap-2">
                                <Shield className="h-4 w-4 text-primary" />
                                <FormLabel className="text-base font-semibold">
                                  End-to-End Encryption
                                </FormLabel>
                              </div>
                              <FormDescription className="text-sm leading-snug">
                                Encrypt files natively in the browser before upload.
                              </FormDescription>
                              <a
                                href="/blog/encryption-pros-cons"
                                target="_blank"
                                className="inline-flex mt-1 items-center gap-1 text-xs font-medium text-primary hover:underline"
                              >
                                Read trade-offs <ExternalLink className="h-3 w-3" />
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

                {/* ── Step 4: Security Setup (Passkey + Vault) ── */}
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
                      <KeyRound className="h-16 w-16 mx-auto text-primary" />
                      <h2 className="text-2xl font-bold">Secure your account</h2>
                      <p className="text-muted-foreground max-w-sm mx-auto">
                        Set up a passkey for passwordless login, and an encryption
                        passphrase to protect your E2EE files.
                      </p>
                    </div>

                    <div className="space-y-4 max-w-md mx-auto">
                      {/* Passkey */}
                      <div className="rounded-xl border-2 p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <Fingerprint className="h-5 w-5 text-primary" />
                          <span className="font-semibold">Passkey (recommended)</span>
                          {passkeyRegistered && (
                            <CheckCircle2 className="h-4 w-4 text-green-500 ml-auto" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Synced to iCloud / Google Password Manager — survives device loss.
                        </p>
                        <Button
                          type="button"
                          variant={passkeyRegistered ? "outline" : "default"}
                          size="sm"
                          onClick={handleRegisterPasskey}
                          disabled={passkeyLoading || passkeyRegistered}
                          className="w-full"
                        >
                          {passkeyRegistered
                            ? "✓ Passkey registered"
                            : passkeyLoading
                            ? "Registering..."
                            : "Register Passkey"}
                        </Button>
                      </div>

                      {/* Encryption Passphrase */}
                      <div className="rounded-xl border-2 p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <Shield className="h-5 w-5 text-primary" />
                          <span className="font-semibold">Encryption Passphrase</span>
                          {securityDone && (
                            <CheckCircle2 className="h-4 w-4 text-green-500 ml-auto" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Used to derive your Master Key client-side. Never sent to our servers.
                        </p>
                        {!securityDone ? (
                          <>
                            <div className="relative">
                              <Input
                                type={showPassphrase ? "text" : "password"}
                                placeholder="Enter passphrase (min 8 chars)"
                                value={passphrase}
                                onChange={(e) => setPassphrase(e.target.value)}
                                className="pr-10"
                              />
                              <button
                                type="button"
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                                onClick={() => setShowPassphrase((v) => !v)}
                              >
                                {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                            <Input
                              type="password"
                              placeholder="Confirm passphrase"
                              value={passphraseConfirm}
                              onChange={(e) => setPassphraseConfirm(e.target.value)}
                            />
                            <Button
                              type="button"
                              size="sm"
                              onClick={handleSetupVault}
                              disabled={vaultLoading || passphrase.length < 8}
                              className="w-full"
                            >
                              {vaultLoading ? "Creating vault..." : "Create Encryption Vault"}
                            </Button>
                          </>
                        ) : (
                          <p className="text-sm text-green-600 font-medium">✓ Vault created — your files are E2EE protected</p>
                        )}
                      </div>

                      {/* Skip note */}
                      {!securityDone && (
                        <p className="text-xs text-muted-foreground text-center">
                          You can set this up later in Settings. Unencrypted files will still work.
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* ── Step 5: Well Done ── */}
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
                      <h2 className="text-3xl font-bold">You&apos;re All Set!</h2>
                      <p className="text-muted-foreground">
                        Your workspace is ready. Let&apos;s start uploading and
                        sharing files securely.
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="pt-4 border-t w-full flex justify-end">
              {isSecurityStep ? (
                // On security step: show Skip or Continue based on whether vault is done
                <Button
                  type="button"
                  size="lg"
                  onClick={nextStep}
                  className="w-full sm:w-auto min-w-[120px]"
                >
                  {securityDone ? "Continue" : "Skip for now"}{" "}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : step < totalSteps ? (
                <Button
                  type="button"
                  size="lg"
                  onClick={nextStep}
                  className="w-full sm:w-auto min-w-[120px]"
                >
                  Continue <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
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

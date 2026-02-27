"use client";

import { useTransition, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { authClient } from "@/lib/auth/client";
import {
  Moon, Sun, Monitor, Shield, ArrowRight, ExternalLink,
  ChevronLeft, CheckCircle2, Eye, EyeOff, Fingerprint, Lock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { WelcomeBalloons } from "@/components/onboarding/WelcomeBalloons";
import { ChoosePlan } from "@/components/onboarding/ChoosePlan";
import { PersonalSettings } from "@/components/onboarding/PersonalSettings";
import { WellDone } from "@/components/onboarding/WellDone";
import { Button } from "@/components/ui/button";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel,
} from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { setupUserKeyVault, addPRFLayerToVault } from "@/lib/crypto/keySetup";
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
  const totalSteps = 5;

  // Step 4 state
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [vaultCreated, setVaultCreated] = useState(false);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [passkeyAdded, setPasskeyAdded] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const form = useForm({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      theme: (theme as "light" | "dark" | "system") || "system",
      encryptByDefault: false,
      plan: "free",
    },
  });

  const nextStep = () => { if (step < totalSteps) setStep(step + 1); };
  const prevStep = () => { if (step > 1) setStep(step - 1); };

  /** Step 1: Create passphrase vault (required) */
  const handleCreateVault = async () => {
    if (passphrase.length < 8) { toast.error("Passphrase must be at least 8 characters."); return; }
    if (passphrase !== passphraseConfirm) { toast.error("Passphrases do not match."); return; }
    setVaultLoading(true);
    try {
      const session = await authClient.getSession();
      const userId = session?.data?.user?.id;
      if (!userId) throw new Error("Not authenticated");
      const keys = await setupUserKeyVault(passphrase);
      await cacheKeys(userId, keys.privateKey, keys.publicKey);
      setVaultCreated(true);
      toast.success("Vault created! Your files are E2EE protected.");
    } catch {
      toast.error("Failed to create vault. Please try again.");
    } finally {
      setVaultLoading(false);
    }
  };

  /** Step 2 (optional): Add PRF passkey layer on top */
  const handleAddPasskey = async () => {
    setPasskeyLoading(true);
    try {
      const session = await authClient.getSession();
      const userId = session?.data?.user?.id;
      const userName = session?.data?.user?.email || session?.data?.user?.name || "user";
      if (!userId) throw new Error("Not authenticated");

      const result = await addPRFLayerToVault(passphrase, userId, userName);

      if (!result.supported) {
        toast.info("Your browser doesn't support passwordless encryption yet. You can add this later in Settings.");
        return;
      }

      setPasskeyAdded(true);
      toast.success("Passkey added! You can now unlock your vault with biometrics.");
    } catch (e) {
      if (e instanceof Error && e.message === "Passkey registration cancelled") {
        toast.info("Passkey registration cancelled.");
      } else if (e instanceof Error && e.message === "WRONG_PASSWORD") {
        toast.error("Passphrase mismatch. Please restart setup.");
      } else {
        toast.error("Failed to add passkey. You can add it later in Settings.");
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  async function onSubmit(data: OnboardingValues) {
    if (step < totalSteps) { nextStep(); return; }
    startTransition(async () => {
      try {
        setTheme(data.theme);
        const result = await authClient.updateUser({
          // @ts-expect-error additionalFields not strictly typed yet
          onboarded: true,
          encryptByDefault: data.encryptByDefault,
        });
        if (result.error) throw new Error(result.error.message || "Failed to save preferences");
        toast.success("All set!");
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

  const isSecureStep = step === 4;

  return (
    <Card className="border-none shadow-none md:border-solid md:shadow-md bg-transparent md:bg-card">
      <CardContent className="pt-6">
        <div className="flex justify-between items-center mb-6">
          {step > 1 && step < totalSteps ? (
            <Button variant="ghost" size="sm" onClick={prevStep} className="-ml-2">
              <ChevronLeft className="mr-2 h-4 w-4" /> Back
            </Button>
          ) : <div />}
          <div className="flex gap-1">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div key={i} className={`h-2 w-8 rounded-full transition-colors ${
                step >= i + 1 ? "bg-primary" : "bg-muted"
              }`} />
            ))}
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="overflow-hidden min-h-[400px]">
              <AnimatePresence mode="wait">

                {/* Step 1: Welcome */}
                {step === 1 && (
                  <motion.div key="step1" variants={slideVariants} initial="hidden" animate="visible" exit="exit"
                    className="flex flex-col items-center text-center space-y-6">
                    <WelcomeBalloons className="h-64 w-auto drop-shadow-sm" />
                    <div className="space-y-2">
                      <h2 className="text-3xl font-bold tracking-tight">Welcome into Xenode!</h2>
                      <p className="text-muted-foreground px-4 text-balance">
                        We&apos;re thrilled to have you. Let&apos;s get your account personalized in just a few clicks.
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* Step 2: Choose Plan */}
                {step === 2 && (
                  <motion.div key="step2" variants={slideVariants} initial="hidden" animate="visible" exit="exit"
                    className="space-y-6">
                    <div className="text-center space-y-2">
                      <ChoosePlan className="h-48 w-auto mx-auto drop-shadow-sm" />
                      <h2 className="text-2xl font-bold">Choose your plan</h2>
                      <p className="text-muted-foreground">You can change this anytime later.</p>
                    </div>
                    <FormField control={form.control} name="plan" render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="grid md:grid-cols-2 gap-4">
                            {(["free", "pro"] as const).map((val) => (
                              <FormItem key={val}>
                                <FormLabel className="[&:has([data-state=checked])>div]:border-primary [&:has([data-state=checked])>div]:bg-primary/5 cursor-pointer">
                                  <FormControl><RadioGroupItem value={val} className="sr-only" /></FormControl>
                                  <div className="rounded-xl border-2 p-4 transition-all hover:bg-muted">
                                    <div className="flex justify-between items-center mb-2">
                                      <span className="font-semibold text-lg">{val === "free" ? "Starter" : "Pro Builder"}</span>
                                      {field.value === val && <CheckCircle2 className="h-5 w-5 text-primary" />}
                                    </div>
                                    <div className="text-2xl font-bold mb-1">
                                      {val === "free" ? <>₹0<span className="text-sm font-normal text-muted-foreground">/mo</span></> : <>₹1.5<span className="text-sm font-normal text-muted-foreground">/GB</span></>}
                                    </div>
                                    <p className="text-sm text-muted-foreground">{val === "free" ? "Perfect for trying things out." : "For scaling applications."}</p>
                                    <ul className="mt-4 space-y-2 text-sm">
                                      <li className="flex items-center gap-2"><div className="h-1.5 w-1.5 rounded-full bg-primary" />{val === "free" ? "5 GB Storage" : "Unlimited Storage"}</li>
                                      <li className="flex items-center gap-2"><div className="h-1.5 w-1.5 rounded-full bg-primary" />{val === "free" ? "Community Support" : "Priority Support"}</li>
                                    </ul>
                                  </div>
                                </FormLabel>
                              </FormItem>
                            ))}
                          </RadioGroup>
                        </FormControl>
                      </FormItem>
                    )} />
                  </motion.div>
                )}

                {/* Step 3: Preferences */}
                {step === 3 && (
                  <motion.div key="step3" variants={slideVariants} initial="hidden" animate="visible" exit="exit"
                    className="space-y-6">
                    <div className="text-center space-y-2">
                      <PersonalSettings className="h-48 w-auto mx-auto drop-shadow-sm" />
                      <h2 className="text-2xl font-bold">Preferences</h2>
                      <p className="text-muted-foreground">Customize your working environment</p>
                    </div>
                    <div className="space-y-6 max-w-lg mx-auto">
                      <FormField control={form.control} name="theme" render={({ field }) => (
                        <FormItem className="space-y-3">
                          <FormLabel className="font-semibold">Appearance</FormLabel>
                          <FormControl>
                            <RadioGroup onValueChange={(val) => { field.onChange(val); setTheme(val); }}
                              defaultValue={field.value} className="grid grid-cols-3 gap-4">
                              {(["light", "dark", "system"] as const).map((val) => (
                                <FormItem key={val}>
                                  <FormLabel className="[&:has([data-state=checked])>div]:border-primary cursor-pointer transition-all">
                                    <FormControl><RadioGroupItem value={val} className="sr-only" /></FormControl>
                                    <div className="items-center rounded-xl border-2 border-muted bg-popover p-1 hover:bg-accent">
                                      <div className={`space-y-2 rounded-sm p-2 ${ val === "dark" ? "bg-slate-950" : val === "light" ? "bg-[#ecedef]" : "bg-[#ecedef] dark:bg-slate-950" }`}>
                                        <div className={`space-y-2 rounded-md p-2 shadow-sm ${ val === "dark" ? "bg-slate-800" : val === "light" ? "bg-white" : "bg-white dark:bg-slate-800" }`}>
                                          <div className={`h-2 w-full rounded-lg ${ val === "dark" ? "bg-slate-400" : "bg-[#ecedef]" }`} />
                                          <div className={`h-2 w-3/4 rounded-lg ${ val === "dark" ? "bg-slate-400" : "bg-[#ecedef]" }`} />
                                        </div>
                                        <div className={`flex items-center space-x-2 rounded-md p-2 shadow-sm ${ val === "dark" ? "bg-slate-800" : val === "light" ? "bg-white" : "bg-white dark:bg-slate-800" }`}>
                                          {val === "light" && <Sun className="h-4 w-4 text-muted-foreground" />}
                                          {val === "dark" && <Moon className="h-4 w-4 text-slate-400" />}
                                          {val === "system" && <Monitor className="h-4 w-4 text-muted-foreground" />}
                                        </div>
                                      </div>
                                    </div>
                                    <span className="block w-full pt-2 text-center text-sm font-medium capitalize">{val}</span>
                                  </FormLabel>
                                </FormItem>
                              ))}
                            </RadioGroup>
                          </FormControl>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="encryptByDefault" render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-xl border-2 p-4">
                          <div className="space-y-1 mr-4">
                            <div className="flex items-center gap-2">
                              <Shield className="h-4 w-4 text-primary" />
                              <FormLabel className="text-base font-semibold">End-to-End Encryption</FormLabel>
                            </div>
                            <FormDescription className="text-sm leading-snug">
                              Encrypt files natively in the browser before upload.
                            </FormDescription>
                            <a href="/blog/encryption-pros-cons" target="_blank"
                              className="inline-flex mt-1 items-center gap-1 text-xs font-medium text-primary hover:underline">
                              Read trade-offs <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )} />
                    </div>
                  </motion.div>
                )}

                {/* Step 4: Secure your files */}
                {step === 4 && (
                  <motion.div key="step4" variants={slideVariants} initial="hidden" animate="visible" exit="exit"
                    className="space-y-6">
                    <div className="text-center space-y-2">
                      <div className="h-16 w-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
                        {vaultCreated && passkeyAdded
                          ? <CheckCircle2 className="h-8 w-8 text-green-500" />
                          : <Lock className="h-8 w-8 text-primary" />}
                      </div>
                      <h2 className="text-2xl font-bold">Secure your files</h2>
                      <p className="text-muted-foreground max-w-sm mx-auto text-sm">
                        Set an encryption passphrase to protect your files.
                        Optionally add a passkey for biometric unlock.
                      </p>
                    </div>

                    <div className="space-y-4 max-w-md mx-auto">

                      {/* ── Section 1: Passphrase (required) ── */}
                      <div className={`rounded-xl border-2 p-4 space-y-3 ${
                        vaultCreated ? "border-green-500/50 bg-green-500/5" : ""
                      }`}>
                        <div className="flex items-center gap-2">
                          <Shield className="h-5 w-5 text-primary" />
                          <span className="font-semibold">Encryption Passphrase</span>
                          <span className="ml-auto text-xs text-muted-foreground">Required</span>
                          {vaultCreated && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                        </div>

                        {!vaultCreated ? (
                          <>
                            <p className="text-xs text-muted-foreground">
                              Used to derive your Master Key. Never sent to our servers.
                            </p>
                            <div className="relative">
                              <Input
                                type={showPassphrase ? "text" : "password"}
                                placeholder="Enter passphrase (min 8 chars)"
                                value={passphrase}
                                onChange={(e) => setPassphrase(e.target.value)}
                                className="pr-10"
                              />
                              <button type="button"
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                                onClick={() => setShowPassphrase((v) => !v)}>
                                {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                            <Input
                              type="password"
                              placeholder="Confirm passphrase"
                              value={passphraseConfirm}
                              onChange={(e) => setPassphraseConfirm(e.target.value)}
                            />
                            <Button type="button" className="w-full"
                              onClick={handleCreateVault}
                              disabled={vaultLoading || passphrase.length < 8}>
                              {vaultLoading ? "Creating vault..." : "Create Vault"}
                            </Button>
                          </>
                        ) : (
                          <p className="text-sm text-green-600 font-medium">
                            ✓ Vault secured with passphrase
                          </p>
                        )}
                      </div>

                      {/* ── Section 2: Passkey (optional, only shown after vault created) ── */}
                      {vaultCreated && (
                        <div className={`rounded-xl border-2 p-4 space-y-3 ${
                          passkeyAdded ? "border-green-500/50 bg-green-500/5" : ""
                        }`}>
                          <div className="flex items-center gap-2">
                            <Fingerprint className="h-5 w-5 text-primary" />
                            <span className="font-semibold">Passkey</span>
                            <span className="ml-auto text-xs text-muted-foreground">Optional</span>
                            {passkeyAdded && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                          </div>

                          {!passkeyAdded ? (
                            <>
                              <p className="text-xs text-muted-foreground">
                                Add biometric unlock (Face ID / fingerprint / PIN).
                                Syncs across devices via Google PM or iCloud.
                                You can also add this later in Settings.
                              </p>
                              <Button type="button" variant="outline" className="w-full"
                                onClick={handleAddPasskey}
                                disabled={passkeyLoading}>
                                {passkeyLoading ? "Adding passkey..." : <><Fingerprint className="mr-2 h-4 w-4" /> Add Passkey</>}
                              </Button>
                            </>
                          ) : (
                            <p className="text-sm text-green-600 font-medium">
                              ✓ Passkey added — biometric unlock enabled
                            </p>
                          )}
                        </div>
                      )}

                      {!vaultCreated && (
                        <p className="text-xs text-muted-foreground text-center">
                          You can skip this and set it up later in Settings.
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* Step 5: Well Done */}
                {step === 5 && (
                  <motion.div key="step5" variants={slideVariants} initial="hidden" animate="visible" exit="exit"
                    className="flex flex-col items-center text-center space-y-6 py-6">
                    <WellDone className="h-64 w-auto drop-shadow-sm" />
                    <div className="space-y-2">
                      <h2 className="text-3xl font-bold">You&apos;re All Set!</h2>
                      <p className="text-muted-foreground">
                        Your workspace is ready. Let&apos;s start uploading and sharing files securely.
                      </p>
                    </div>
                  </motion.div>
                )}

              </AnimatePresence>
            </div>

            <div className="pt-4 border-t w-full flex justify-end">
              {isSecureStep ? (
                <Button type="button" size="lg" onClick={nextStep}
                  className="w-full sm:w-auto min-w-[120px]">
                  {vaultCreated ? "Continue" : "Skip for now"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : step < totalSteps ? (
                <Button type="button" size="lg" onClick={nextStep}
                  className="w-full sm:w-auto min-w-[120px]">
                  Continue <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <Button type="submit" size="lg" disabled={isPending}
                  className="w-full sm:w-auto min-w-[150px]">
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

"use client";

import { useTransition, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { authClient, useSession } from "@/lib/auth/client";
import { useCrypto } from "@/contexts/CryptoContext";
import { generateRecoveryKit } from "@/lib/crypto/recovery";
import type { IPlan } from "@/models/PricingConfig";
import {
  Moon,
  Sun,
  Monitor,
  ArrowRight,
  ChevronLeft,
  CheckCircle2,
  ShieldCheck,
  Copy,
  Download,
  Loader2,
  Eye,
  EyeOff,
  RefreshCw,
  Upload,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { WelcomeBalloons } from "@/components/onboarding/WelcomeBalloons";
import { PersonalSettings } from "@/components/onboarding/PersonalSettings";
import { WellDone } from "@/components/onboarding/WellDone";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import AnimatedGivingHeart from "@/components/onboarding/AnimatedWelcome";
import ForgotPasswordGraphic from "@/components/onboarding/ForgotPasswordGraphic";

// ─── Schema ─────────────────────────────────────────────────────────────────────────────────

const onboardingSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  encryptByDefault: z.boolean(),
  selectedPlan: z.string(),
  avatarUrl: z.string().optional(),
});

type OnboardingValues = z.infer<typeof onboardingSchema>;

// ─── Component ───────────────────────────────────────────────────────────────────────────

export function OnboardingForm() {
  const router = useRouter();
  const { setTheme, theme } = useTheme();
  const { setup } = useCrypto();
  const { data: session } = useSession();
  const [isPending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);

  // Steps: 1=Welcome 2=Recovery Kit 3=Preferences 4=Choose Avatar 5=Well Done
  const totalSteps = 5;
  const [step, setStep] = useState(1);

  // Vault password (read from session storage invisibly)
  const [kit] = useState(() => generateRecoveryKit());
  const [vaultPassword, setVaultPassword] = useState("");
  const [inputPassword, setInputPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showOnboardingPassword, setShowOnboardingPassword] = useState(false);

  // Step 2: recovery kit
  const [kitSaved, setKitSaved] = useState(false);

  // Plans fetched from DB
  const [plans, setPlans] = useState<IPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);

  // Avatar states
  const [randomAvatars, setRandomAvatars] = useState<string[]>([]);
  const [customAvatarPreview, setCustomAvatarPreview] = useState<string | null>(
    null,
  );
  const [customAvatarFile, setCustomAvatarFile] = useState<File | null>(null);
  const [isFetchingAvatars, setIsFetchingAvatars] = useState(false);

  useEffect(() => {
    setMounted(true);
    const pw = sessionStorage.getItem("xenode-vault-pw");
    if (pw) {
      setVaultPassword(pw);
    }
  }, []);

  const handleContinueStep1 = () => {
    if (!vaultPassword) {
      const trimmedPw = inputPassword.trim();
      if (!trimmedPw) {
        toast.error("Please enter a Master Password to secure your vault.");
        return;
      }
      if (trimmedPw.length < 8) {
        toast.error("Master Password must be at least 8 characters long.");
        return;
      }
      if (trimmedPw !== confirmPassword.trim()) {
        toast.error("Passwords do not match.");
        return;
      }
      setVaultPassword(trimmedPw);
      sessionStorage.setItem("xenode-vault-pw", trimmedPw);
    }
    nextStep();
  };

  // Fetch live plans from DB when component mounts
  useEffect(() => {
    fetch("/api/admin/pricing/plans-public")
      .then((r) => r.json())
      .then((data) => {
        if (data.plans) setPlans(data.plans);
      })
      .catch(() => {
        // silently fall back — plan picker just shows nothing until load
      })
      .finally(() => setPlansLoading(false));
  }, []);

  const form = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      theme: (theme as "light" | "dark" | "system") || "system",
      encryptByDefault: true,
      selectedPlan: "free",
      avatarUrl: "",
    },
  });

  const fetchRandomAvatars = useCallback(async () => {
    setIsFetchingAvatars(true);
    try {
      const res = await fetch("/api/avatars");
      const data = await res.json();
      if (data.avatars) {
        setRandomAvatars(data.avatars);
        if (!form.getValues("avatarUrl") && !customAvatarPreview) {
          form.setValue("avatarUrl", data.avatars[0]);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsFetchingAvatars(false);
    }
  }, [form, customAvatarPreview]);

  useEffect(() => {
    if (step === 4 && randomAvatars.length === 0) {
      fetchRandomAvatars();
    }
  }, [step, randomAvatars.length, fetchRandomAvatars]);

  const handleCustomAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCustomAvatarFile(file);
      const url = URL.createObjectURL(file);
      setCustomAvatarPreview(url);
      form.setValue("avatarUrl", "custom");
    }
  };

  const selectedPlan = form.watch("selectedPlan");
  const isPaidPlan = selectedPlan !== "free";
  const chosenPlanConfig = plans.find((p) => p.slug === selectedPlan);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(kit.words.join(" "));
    toast.success("Recovery kit copied");
  }, [kit]);

  const [pdfGenerating, setPdfGenerating] = useState(false);

  const handleDownloadPDF = useCallback(async () => {
    setPdfGenerating(true);
    let iframe: HTMLIFrameElement | null = null;
    try {
      // Render the real recovery-kit.html template in a hidden same-origin
      // iframe and hand it to the browser's native print → "Save as PDF".
      // This is fully client-side (E2EE-safe — the phrase never leaves the
      // browser), produces selectable text, and matches the template exactly.
      // The master password is intentionally NOT included: the 12-word phrase
      // alone recovers the vault, so embedding the password only adds exposure.
      const templateHtml = await (
        await fetch("/html/recovery-kit.html")
      ).text();

      const userEmail = session?.user?.email ?? "";
      const generatedDate = new Date().toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const userName = session?.user?.name ?? "user";
      const sanitizedName = userName
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");

      const populated = templateHtml
        .replace(/\{\{userEmail\}\}/g, userEmail)
        .replace(/\{\{generatedDate\}\}/g, generatedDate)
        .replace(/\{\{recoveryPhrase\}\}/g, kit.words.join(" "))
        // Password card hides itself when this is empty (CSS :empty rule)
        .replace(/\{\{accountPassword\}\}/g, "")
        // The browser uses <title> as the default "Save as PDF" filename
        .replace(
          /<title>[^<]*<\/title>/i,
          `<title>xenode-recovery-kit-${sanitizedName}</title>`,
        );

      iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.cssText =
        "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
      document.body.appendChild(iframe);

      const idoc = iframe.contentDocument;
      if (!idoc) throw new Error("Could not access iframe document");
      idoc.open();
      idoc.write(populated);
      idoc.close();

      // Wait for the iframe (fonts, inline phrase-grid script, logo) to settle
      await new Promise<void>((resolve) => {
        if (idoc.readyState === "complete") resolve();
        else iframe!.addEventListener("load", () => resolve(), { once: true });
      });
      await new Promise((r) => setTimeout(r, 200));

      // Chrome derives the "Save as PDF" filename from the TOP document's title,
      // not the iframe's. Temporarily swap it, then restore once printing ends.
      const fileTitle = `xenode-recovery-kit-${sanitizedName}`;
      const prevTitle = document.title;
      document.title = fileTitle;

      // Idempotent teardown — restore the title and remove the iframe. Driven by
      // afterprint (fires when the dialog closes) so we never pull the source
      // document out from under an open print preview. The long timeout is only
      // a leak-guard for browsers that don't emit afterprint.
      const frameRef = iframe;
      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        document.title = prevTitle;
        window.removeEventListener("afterprint", cleanup);
        if (frameRef.parentNode) frameRef.parentNode.removeChild(frameRef);
      };
      window.addEventListener("afterprint", cleanup, { once: true });
      setTimeout(cleanup, 60000);
      iframe = null;

      // Trigger the browser's print dialog targeted at the iframe content
      frameRef.contentWindow?.focus();
      frameRef.contentWindow?.print();

      toast.success("Choose “Save as PDF” to download your recovery kit");
    } catch (err) {
      console.error("PDF generation failed:", err);
      toast.error("Could not open the PDF — try copying the phrase instead.");
      if (iframe?.parentNode) iframe.parentNode.removeChild(iframe);
    } finally {
      setPdfGenerating(false);
    }
  }, [kit, session]);

  const nextStep = () => {
    if (step < totalSteps) setStep(step + 1);
  };
  const prevStep = () => {
    if (step > 1) setStep(step - 1);
  };

  async function onSubmit(data: OnboardingValues) {
    if (step !== totalSteps) {
      nextStep();
      return;
    }

    startTransition(async () => {
      try {
        if (!vaultPassword) {
          throw new Error("Missing vault bootstrap password");
        }

        // 1. Apply theme
        setTheme(data.theme);

        // 2. Setup vault
        await setup(vaultPassword, kit.passphrase);
        sessionStorage.removeItem("xenode-vault-pw");

        // 3. Mark onboarded + save preferences
        let finalAvatarUrl = data.avatarUrl;

        if (customAvatarFile && data.avatarUrl === "custom") {
          const formData = new FormData();
          formData.append("file", customAvatarFile);
          const uploadRes = await fetch("/api/user/avatar", {
            method: "POST",
            body: formData,
          });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            finalAvatarUrl = uploadData.url;
          }
        }

        const result = await authClient.updateUser({
          // @ts-expect-error additionalFields
          onboarded: true,
          encryptByDefault: data.encryptByDefault,
          ...(finalAvatarUrl && finalAvatarUrl !== "custom"
            ? { image: finalAvatarUrl }
            : {}),
        });
        if (result.error)
          throw new Error(result.error.message || "Failed to save preferences");

        // 4. Always create Usage doc as free first.
        //    For paid plans: PayU success webhook upgrades it after payment.
        //    For free plan: this is the final state.
        const usageRes = await fetch("/api/onboarding/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!usageRes.ok) {
          const err = await usageRes.json().catch(() => ({}));
          throw new Error(err?.error || "Failed to initialise storage quota");
        }

        // 5a. Free plan — straight to dashboard
        if (!isPaidPlan) {
          toast.success("All set! Welcome to Xenode.");
          router.push("/dashboard");
          router.refresh();
          return;
        }

        // 5b. Paid plan — send to /checkout?plan=<slug>
        //     Checkout page handles phone, billing address, PayU, proration — everything.
        router.push(`/checkout?plan=${selectedPlan}`);
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
                className={`h-2 w-8 rounded-full transition-colors ${step >= i + 1 ? "bg-primary" : "bg-muted"}`}
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
                        We&apos;re thrilled to have you. Let&apos;s get your
                        account personalized and set up perfectly for your needs
                        in just a few clicks.
                      </p>
                    </div>
                    {!vaultPassword && (
                      <div className="w-full max-w-sm space-y-4 text-left mt-4 border border-border bg-card p-4 rounded-xl shadow-sm">
                        <p className="text-xs text-muted-foreground text-center mb-2">
                          Please set a Master Password to encrypt and secure
                          your end-to-end encrypted E2EE vault.
                        </p>
                        <div className="space-y-1.5">
                          <label
                            className="text-sm font-semibold"
                            htmlFor="onboarding-password"
                          >
                            Master Password
                          </label>
                          <div className="relative">
                            <Input
                              id="onboarding-password"
                              type={
                                showOnboardingPassword ? "text" : "password"
                              }
                              placeholder="Enter a secure password"
                              value={inputPassword}
                              onChange={(e) => setInputPassword(e.target.value)}
                              className="h-10 bg-background pr-10"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setShowOnboardingPassword(
                                  !showOnboardingPassword,
                                )
                              }
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                              {showOnboardingPassword ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label
                            className="text-sm font-semibold"
                            htmlFor="onboarding-confirm-password"
                          >
                            Confirm Password
                          </label>
                          <Input
                            id="onboarding-confirm-password"
                            type="password"
                            placeholder="Confirm your password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="h-10 bg-background"
                          />
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}

                {/* ───── STEP 2: Recovery Kit ───── */}
                {step === 2 && (
                  <motion.div
                    key="step2"
                    variants={slideVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="space-y-4"
                  >
                    <div className="flex flex-col items-center text-center space-y-2">
                      <ForgotPasswordGraphic className="h-64 w-auto drop-shadow-sm my-4" />
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
                        onClick={handleDownloadPDF}
                        disabled={pdfGenerating}
                      >
                        {pdfGenerating ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Preparing…
                          </>
                        ) : (
                          <>
                            <Download className="mr-2 h-4 w-4" /> Save as PDF
                          </>
                        )}
                      </Button>
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
                        I&apos;ve saved my recovery kit in a safe place
                      </span>
                    </label>
                  </motion.div>
                )}

                {/* ───── STEP 3: Preferences ───── */}
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
                      {/* ── Theme picker ── */}
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
                    </div>
                  </motion.div>
                )}

                {/* ───── STEP 4: Choose Avatar ───── */}
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
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mx-auto">
                        {/* Show selected avatar preview or a generic icon */}
                        {form.watch("avatarUrl") &&
                        form.watch("avatarUrl") !== "custom" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={form.watch("avatarUrl")}
                            alt="Selected avatar"
                            crossOrigin="anonymous"
                            className="w-full h-full rounded-full object-cover"
                          />
                        ) : customAvatarPreview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={customAvatarPreview}
                            alt="Custom avatar"
                            crossOrigin="anonymous"
                            className="w-full h-full rounded-full object-cover"
                          />
                        ) : (
                          <Upload className="h-7 w-7 text-primary" />
                        )}
                      </div>
                      <h2 className="text-2xl font-bold">Choose your Avatar</h2>
                      <p className="text-muted-foreground text-sm">
                        Pick one that feels like you, or upload your own photo.
                      </p>
                    </div>

                    <FormField
                      control={form.control}
                      name="avatarUrl"
                      render={({ field }) => (
                        <FormItem className="space-y-4">
                          <div className="flex items-center justify-between">
                            <FormLabel className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                              Random picks
                            </FormLabel>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={fetchRandomAvatars}
                              disabled={isFetchingAvatars}
                              className="h-8 px-3 text-muted-foreground hover:text-foreground"
                            >
                              <RefreshCw
                                className={`h-3.5 w-3.5 mr-1.5 ${isFetchingAvatars ? "animate-spin" : ""}`}
                              />
                              Randomize
                            </Button>
                          </div>

                          <FormControl>
                            <div className="space-y-4">
                              {isFetchingAvatars &&
                              randomAvatars.length === 0 ? (
                                <div className="flex flex-wrap gap-3">
                                  {Array.from({ length: 10 }).map((_, i) => (
                                    <div
                                      key={i}
                                      className="w-14 h-14 rounded-full bg-muted animate-pulse"
                                    />
                                  ))}
                                </div>
                              ) : (
                                <RadioGroup
                                  onValueChange={(val) => {
                                    field.onChange(val);
                                    if (val !== "custom") {
                                      setCustomAvatarPreview(null);
                                      setCustomAvatarFile(null);
                                    }
                                  }}
                                  value={field.value}
                                  className="flex flex-wrap gap-3"
                                >
                                  {randomAvatars.map((url) => (
                                    <FormItem key={url} className="relative">
                                      <FormControl>
                                        <RadioGroupItem
                                          value={url}
                                          className="sr-only"
                                        />
                                      </FormControl>
                                      <FormLabel className="cursor-pointer block">
                                        <div
                                          className={`w-14 h-14 rounded-full overflow-hidden border-2 transition-all duration-150 ${
                                            field.value === url
                                              ? "border-primary ring-2 ring-primary/30 scale-110 shadow-lg"
                                              : "border-transparent opacity-60 hover:opacity-100 hover:scale-105"
                                          }`}
                                        >
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img
                                            src={url}
                                            alt="Avatar option"
                                            crossOrigin="anonymous"
                                            className="w-full h-full object-cover bg-muted"
                                          />
                                        </div>
                                      </FormLabel>
                                    </FormItem>
                                  ))}

                                  {/* Custom upload tile */}
                                  <FormItem className="relative">
                                    <FormControl>
                                      <RadioGroupItem
                                        value="custom"
                                        className="sr-only"
                                      />
                                    </FormControl>
                                    <FormLabel className="cursor-pointer block">
                                      <label
                                        htmlFor="custom-avatar-input"
                                        className="cursor-pointer"
                                      >
                                        <div
                                          className={`w-14 h-14 rounded-full overflow-hidden border-2 flex items-center justify-center transition-all duration-150 ${
                                            field.value === "custom"
                                              ? "border-primary ring-2 ring-primary/30 scale-110 shadow-lg bg-primary/5"
                                              : "border-dashed border-muted-foreground/40 opacity-60 hover:opacity-100 hover:scale-105 bg-muted/30"
                                          }`}
                                        >
                                          {customAvatarPreview ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                              src={customAvatarPreview}
                                              alt="Custom avatar"
                                              crossOrigin="anonymous"
                                              className="w-full h-full object-cover"
                                            />
                                          ) : (
                                            <Upload className="h-5 w-5 text-muted-foreground" />
                                          )}
                                        </div>
                                      </label>
                                    </FormLabel>
                                    <Input
                                      id="custom-avatar-input"
                                      type="file"
                                      accept="image/*"
                                      className="hidden"
                                      onChange={handleCustomAvatarSelect}
                                      onClick={(e) => {
                                        (e.target as HTMLInputElement).value =
                                          "";
                                      }}
                                    />
                                  </FormItem>
                                </RadioGroup>
                              )}

                              {field.value === "custom" &&
                                !customAvatarPreview && (
                                  <p className="text-sm text-muted-foreground">
                                    Click the upload tile above to choose a
                                    photo from your device.
                                  </p>
                                )}
                            </div>
                          </FormControl>
                        </FormItem>
                      )}
                    />
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
                    <AnimatedGivingHeart className="h-64 w-auto drop-shadow-sm" />
                    <div className="space-y-2">
                      <h2 className="text-3xl font-bold">
                        You&apos;re All Set!
                      </h2>
                      <p className="text-muted-foreground">
                        Your vault is protected and your workspace is ready.
                        {isPaidPlan
                          ? " One last step — complete your payment to activate your plan."
                          : " Let's start uploading and sharing files securely."}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── Footer buttons ── */}
            <div className="pt-4 border-t w-full flex justify-end">
              {step === 2 && (
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
              {step !== 2 && step < totalSteps && (
                <Button
                  type="button"
                  size="lg"
                  onClick={step === 1 ? handleContinueStep1 : nextStep}
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
                  className="w-full sm:w-auto min-w-[180px]"
                >
                  {isPending
                    ? isPaidPlan
                      ? "Redirecting…"
                      : "Setting up..."
                    : isPaidPlan
                      ? `Continue to Checkout → ₹${chosenPlanConfig?.pricing.find((p) => p.cycle === "monthly")?.priceINR ?? 0}/mo`
                      : "Go to Dashboard"}
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

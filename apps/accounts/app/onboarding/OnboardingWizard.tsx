"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronLeft,
  Copy,
  Download,
  Loader2,
  Monitor,
  Moon,
  RefreshCw,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { generateRecoveryMnemonic } from "@xenode/crypto-core";
import { createAccountVault } from "@/lib/vault-setup";
import {
  generateAvatarBatch,
  type GeneratedAvatar,
} from "@/components/onboarding/avatars";
import {
  GivingHeart,
  PreferencesScene,
  RecoveryShield,
  WelcomeBalloons,
} from "@/components/onboarding/illustrations";

const TOTAL_STEPS = 5;

const slideVariants = {
  hidden: { opacity: 0, x: 24 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, x: -24, transition: { duration: 0.2 } },
};

type ThemeChoice = "light" | "dark" | "system";

async function downscaleToDataUri(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function OnboardingWizard({
  accountId,
  email,
  name,
  next,
}: {
  accountId: string;
  email: string;
  name: string;
  next: string;
}) {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Recovery kit — generated once, shown at step 2, sealed into the vault at the end.
  const [kit, setKit] = useState<{ words: string; secret: Uint8Array } | null>(null);
  const [kitSaved, setKitSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  // The signup password is stashed in sessionStorage; if it's missing (direct
  // navigation) the Welcome step collects it instead.
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [hasStashedPassword, setHasStashedPassword] = useState(true);

  const { theme, setTheme } = useTheme();
  const themeChoice = (theme as ThemeChoice) ?? "system";

  const [avatars, setAvatars] = useState<GeneratedAvatar[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [avatarLoading, setAvatarLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void generateRecoveryMnemonic().then(setKit);
    try {
      const stashed = sessionStorage.getItem("xenode-vault-pw") ?? "";
      if (stashed.length >= 12) {
        setPassword(stashed);
      } else {
        setHasStashedPassword(false);
      }
    } catch {
      setHasStashedPassword(false);
    }
  }, []);

  // Load avatar options the first time the avatar step opens.
  useEffect(() => {
    if (step === 4 && avatars.length === 0) {
      const batch = generateAvatarBatch();
      setAvatars(batch);
      if (!avatarUrl) setAvatarUrl(batch[0]?.url ?? "");
    }
  }, [step, avatars.length, avatarUrl]);

  const firstName = useMemo(() => name.trim().split(/\s+/)[0] || "there", [name]);

  function nextStep() {
    setError("");
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }
  function prevStep() {
    setError("");
    setStep((s) => Math.max(s - 1, 1));
  }

  function handleWelcomeContinue() {
    if (!hasStashedPassword) {
      if (password.length < 12) {
        setError("Use a password of at least 12 characters.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }
      try {
        sessionStorage.setItem("xenode-vault-pw", password);
      } catch {
        /* storage disabled — kept in memory for this session */
      }
    }
    nextStep();
  }

  async function handleCopy() {
    if (!kit) return;
    try {
      await navigator.clipboard.writeText(kit.words);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — write the words down instead.");
    }
  }

  async function handleDownloadPdf() {
    if (!kit) return;
    setPdfBusy(true);
    try {
      const template = await fetch("/recovery-kit.html").then((r) => r.text());
      const generatedDate = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const populated = template
        .replaceAll("{{userEmail}}", email || accountId)
        .replaceAll("{{generatedDate}}", generatedDate)
        .replaceAll("{{recoveryPhrase}}", kit.words);

      const frame = document.createElement("iframe");
      frame.style.cssText =
        "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
      document.body.appendChild(frame);
      const idoc = frame.contentWindow?.document;
      if (!idoc) throw new Error("Print frame unavailable");
      idoc.open();
      idoc.write(populated);
      idoc.close();

      const originalTitle = document.title;
      const cleanup = () => {
        document.title = originalTitle;
        frame.remove();
        window.removeEventListener("afterprint", cleanup);
      };
      window.addEventListener("afterprint", cleanup);
      setTimeout(() => {
        // Chrome derives the "Save as PDF" filename from the top document title.
        document.title = "xenode-recovery-kit";
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      }, 250);
      // Leak guard in case afterprint never fires.
      setTimeout(cleanup, 60_000);
    } catch {
      setError("Couldn't prepare the PDF — copy the words instead.");
    } finally {
      setPdfBusy(false);
    }
  }

  function randomizeAvatars() {
    setAvatarLoading(true);
    const batch = generateAvatarBatch();
    setAvatars(batch);
    setAvatarUrl(batch[0]?.url ?? "");
    setTimeout(() => setAvatarLoading(false), 250);
  }

  async function handleCustomAvatar(file: File | undefined) {
    if (!file) return;
    try {
      const uri = await downscaleToDataUri(file);
      if (uri.length > 24_000) {
        setError("That image is too large — try a simpler one.");
        return;
      }
      setAvatars((current) => [{ id: -1, url: uri }, ...current]);
      setAvatarUrl(uri);
    } catch {
      setError("Couldn't read that image.");
    }
  }

  async function finalize() {
    if (!kit) return;
    if (password.length < 12) {
      setError("Your vault password is missing — start again from sign in.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setTheme(themeChoice);
      try {
        await createAccountVault({
          accountId,
          password,
          recoverySecret: kit.secret,
        });
      } catch (vaultError) {
        // A vault may already exist (re-entered onboarding) — tolerate that and
        // still record the account preferences below.
        const message =
          vaultError instanceof Error ? vaultError.message : "";
        if (!/revision|exist|conflict/iu.test(message)) throw vaultError;
      }
      await fetch("/api/onboarding/complete", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          theme: themeChoice,
          defaultEncrypt: true,
          image: avatarUrl || undefined,
        }),
      });
      kit.secret.fill(0);
      try {
        sessionStorage.removeItem("xenode-vault-pw");
      } catch {
        /* ignore */
      }
      window.location.assign(next);
    } catch (finalError) {
      setError(
        finalError instanceof Error
          ? finalError.message
          : "Something went wrong finishing setup.",
      );
      setBusy(false);
    }
  }

  return (
    <main className="onb-shell">
      <div className="onb-card">
        <div className="onb-progress" aria-hidden="true">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <span
              key={i}
              className={`onb-pill${step >= i + 1 ? " is-active" : ""}`}
            />
          ))}
        </div>

        <div className="onb-stage">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                variants={slideVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="onb-step"
              >
                <WelcomeBalloons className="onb-art" />
                <p className="eyebrow">Welcome to Xenode</p>
                <h1>Hi {firstName}, let&rsquo;s set up your account</h1>
                <p className="lede">
                  A few quick steps to secure your end-to-end encrypted vault and
                  make Xenode yours.
                </p>
                {!hasStashedPassword && (
                  <div className="onb-form">
                    <div className="field">
                      <label htmlFor="onb-pw">Create your vault password</label>
                      <input
                        id="onb-pw"
                        className="input"
                        type="password"
                        minLength={12}
                        autoComplete="new-password"
                        placeholder="At least 12 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="onb-confirm">Confirm password</label>
                      <input
                        id="onb-confirm"
                        className="input"
                        type="password"
                        minLength={12}
                        autoComplete="new-password"
                        placeholder="Re-enter your password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                      />
                    </div>
                  </div>
                )}
                <button className="button button-block" onClick={handleWelcomeContinue}>
                  Get started
                </button>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                variants={slideVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="onb-step"
              >
                <RecoveryShield className="onb-art" />
                <p className="eyebrow">Recovery kit</p>
                <h1>Save your 12-word recovery phrase</h1>
                <p className="lede">
                  This is the only way to recover your vault if you forget your
                  password. Xenode can never see or reset it.
                </p>
                {kit ? (
                  <ol className="onb-words">
                    {kit.words.split(" ").map((word, i) => (
                      <li key={`${i}-${word}`} className="onb-word">
                        <span className="onb-word-n">{i + 1}</span>
                        <span className="onb-word-w">{word}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="lede">Generating your phrase…</p>
                )}
                <div className="onb-kit-actions">
                  <button
                    className="button button-secondary"
                    onClick={() => void handleCopy()}
                    disabled={!kit}
                    type="button"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    className="button button-secondary"
                    onClick={() => void handleDownloadPdf()}
                    disabled={!kit || pdfBusy}
                    type="button"
                  >
                    {pdfBusy ? (
                      <Loader2 size={16} className="onb-spin" />
                    ) : (
                      <Download size={16} />
                    )}
                    Save as PDF
                  </button>
                </div>
                <label className="checkbox-row" htmlFor="onb-saved">
                  <input
                    id="onb-saved"
                    type="checkbox"
                    checked={kitSaved}
                    onChange={(e) => setKitSaved(e.target.checked)}
                  />
                  <span>I&rsquo;ve saved my recovery phrase somewhere safe</span>
                </label>
                <button
                  className="button button-block"
                  onClick={nextStep}
                  disabled={!kitSaved}
                >
                  Continue
                </button>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                variants={slideVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="onb-step"
              >
                <PreferencesScene className="onb-art" />
                <p className="eyebrow">Appearance</p>
                <h1>Choose your theme</h1>
                <p className="lede">Pick how Xenode looks. You can change it anytime.</p>
                <div className="onb-themes">
                  {(
                    [
                      { value: "light", label: "Light", Icon: Sun },
                      { value: "dark", label: "Dark", Icon: Moon },
                      { value: "system", label: "System", Icon: Monitor },
                    ] as const
                  ).map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      className={`onb-theme-card${
                        themeChoice === value ? " is-selected" : ""
                      }`}
                      onClick={() => setTheme(value)}
                    >
                      <Icon size={22} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                <button className="button button-block" onClick={nextStep}>
                  Continue
                </button>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div
                key="step4"
                variants={slideVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="onb-step"
              >
                <p className="eyebrow">Profile</p>
                <h1>Pick an avatar</h1>
                <p className="lede">Choose one of these, or upload your own.</p>
                <div className="onb-avatars">
                  {avatars.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={`onb-avatar${
                        avatarUrl === a.url ? " is-selected" : ""
                      }`}
                      onClick={() => setAvatarUrl(a.url)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.url} alt="" width={56} height={56} />
                    </button>
                  ))}
                  <button
                    type="button"
                    className="onb-avatar onb-avatar-upload"
                    onClick={() => fileInput.current?.click()}
                  >
                    +
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) =>
                      void handleCustomAvatar(e.target.files?.[0] ?? undefined)
                    }
                  />
                </div>
                <button
                  type="button"
                  className="button button-secondary onb-randomize"
                  onClick={randomizeAvatars}
                >
                  <RefreshCw
                    size={16}
                    className={avatarLoading ? "onb-spin" : undefined}
                  />
                  Shuffle
                </button>
                <button className="button button-block" onClick={nextStep}>
                  Continue
                </button>
              </motion.div>
            )}

            {step === 5 && (
              <motion.div
                key="step5"
                variants={slideVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="onb-step"
              >
                <GivingHeart className="onb-art" />
                <p className="eyebrow">All set</p>
                <h1>You&rsquo;re ready, {firstName}</h1>
                <p className="lede">
                  Your encrypted vault will be created on this device and unlocked
                  automatically across Drive and Photos.
                </p>
                <button
                  className="button button-block"
                  onClick={() => void finalize()}
                  disabled={busy}
                >
                  {busy ? (
                    <>
                      <Loader2 size={16} className="onb-spin" /> Finishing…
                    </>
                  ) : (
                    "Enter Xenode"
                  )}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {error ? (
          <p className="status status-error" role="alert">
            {error}
          </p>
        ) : null}

        {step > 1 && step < TOTAL_STEPS ? (
          <button type="button" className="onb-back" onClick={prevStep}>
            <ChevronLeft size={16} /> Back
          </button>
        ) : null}
      </div>
    </main>
  );
}

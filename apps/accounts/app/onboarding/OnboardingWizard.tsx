"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronLeft,
  Copy,
  Download,
  Globe,
  Loader2,
  Monitor,
  Moon,
  RefreshCw,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { generateRecoveryMnemonic } from "@xenode/crypto-core";
import {
  STORAGE_REGION_LABELS,
  type StorageRegion,
} from "@xenode/config/storage";
import { createAccountVault, prepareAccountVault, type VaultBootstrapAttempt } from "@/lib/vault-setup";
import { confirmVaultUnlock } from "@/lib/password-vault";
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

const TOTAL_STEPS = 6;

const REGION_BLURB: Record<StorageRegion, string> = {
  asia: "The deployment's default storage pool.",
  us: "An R2 United States jurisdiction bucket.",
  eu: "An R2 European Union jurisdiction bucket.",
};

const slideVariants = {
  hidden: { opacity: 0, x: 24 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, x: -24, transition: { duration: 0.2 } },
};

type ThemeChoice = "light" | "dark" | "system";

async function downscaleToDataUri(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 256;
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
  storageRegions,
  hasExistingVault,
  email,
  name,
  username,
  next,
}: {
  accountId: string;
  storageRegions: StorageRegion[];
  hasExistingVault: boolean;
  email: string;
  name: string;
  username: string;
  next: string;
}) {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Recovery kit — generated once, shown at step 2, sealed into the vault at the end.
  const [kit, setKit] = useState<{ words: string; secret: Uint8Array } | null>(
    null,
  );
  const [kitSaved, setKitSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  // Vault secrets are collected separately and never reused for sign-in.
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [trustBrowser, setTrustBrowser] = useState(false);
  const [usernameChoice, setUsernameChoice] = useState(username);

  const { theme, setTheme } = useTheme();
  const themeChoice = (theme as ThemeChoice) ?? "system";

  // Storage region — chosen here once and locked for the account.
  const [region, setRegion] = useState<StorageRegion | "">("");

  const [avatars, setAvatars] = useState<GeneratedAvatar[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [avatarLoading, setAvatarLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const vaultAttempt = useRef<VaultBootstrapAttempt | null>(null);
  const vaultCreated = useRef(false);

  useEffect(() => {
    if (!hasExistingVault) void generateRecoveryMnemonic().then(setKit);
    try {
      sessionStorage.removeItem("xenode-vault-pw");
    } catch {
      /* obsolete secret cache */
    }
  }, [hasExistingVault]);

  // Load avatar options the first time the avatar step opens.
  useEffect(() => {
    if (step === 5 && avatars.length === 0) {
      const batch = generateAvatarBatch();
      queueMicrotask(() => {
        setAvatars(batch);
        if (!avatarUrl) setAvatarUrl(batch[0]?.url ?? "");
      });
    }
  }, [step, avatars.length, avatarUrl]);

  const firstName = useMemo(
    () => name.trim().split(/\s+/)[0] || "there",
    [name],
  );

  function nextStep() {
    setError("");
    setStep((s) =>
      Math.min(s === 1 && hasExistingVault ? 3 : s + 1, TOTAL_STEPS),
    );
  }
  function prevStep() {
    setError("");
    setStep((s) => Math.max(s === 3 && hasExistingVault ? 1 : s - 1, 1));
  }

  function handleWelcomeContinue() {
    if (!username && !/^[a-zA-Z0-9_]{3,30}$/u.test(usernameChoice)) {
      setError(
        "Choose a username using 3–30 letters, numbers, or underscores.",
      );
      return;
    }
    if (!hasExistingVault) {
      if (password.length < 12) {
        setError("Create a Vault password using at least 12 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Vault passwords do not match.");
        return;
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
      const generatedDate = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const { createRecoveryKitPdf } = await import("@/lib/recovery-pdf");
      const bytes = await createRecoveryKitPdf({
        accountLabel: email || accountId,
        generatedDate,
        recoveryPhrase: kit.words,
      });
      const blob = new Blob([Uint8Array.from(bytes).buffer], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "xenode-recovery-kit.pdf";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch {
      setError("Couldn't download the PDF. Copy the words instead.");
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
      setAvatars((current) => [{ id: "custom", url: uri }, ...current]);
      setAvatarUrl(uri);
    } catch {
      setError("Couldn't read that image.");
    }
  }

  async function finalize() {
    if (!hasExistingVault && !kit) return;
    setBusy(true);
    setError("");
    try {
      setTheme(themeChoice);
      if (!hasExistingVault && !vaultCreated.current && kit) {
        vaultAttempt.current ??= await prepareAccountVault({
          accountId, password, recoverySecret: kit.secret, trustDevice: trustBrowser,
        });
        await createAccountVault({
          accountId,
          attempt: vaultAttempt.current,
          password,
          recoverySecret: kit.secret,
        });
        vaultCreated.current = true;
        vaultAttempt.current = null;
      }
      const completionResponse = await fetch("/api/onboarding/complete", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          theme: themeChoice,
          defaultEncrypt: true,
          image: avatarUrl || undefined,
          region: region || undefined,
          username: usernameChoice || undefined,
        }),
      });
      if (!completionResponse.ok) {
        const payload = (await completionResponse.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "Could not finish account setup.");
      }
      kit?.secret.fill(0);
      try {
        sessionStorage.removeItem("xenode-vault-pw");
      } catch {
        /* ignore */
      }
      if (!hasExistingVault) await confirmVaultUnlock("password");
      window.location.assign(`/auth/continue?next=${encodeURIComponent(next)}`);
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
                  A few quick steps to secure your end-to-end encrypted vault
                  and make Xenode yours.
                </p>
                {!username && (
                  <div className="onb-form">
                    <div className="field">
                      <label htmlFor="onb-username">
                        Choose your Xenode username
                      </label>
                      <input
                        id="onb-username"
                        className="input"
                        minLength={3}
                        maxLength={30}
                        pattern="[A-Za-z0-9_]+"
                        autoCapitalize="none"
                        autoComplete="username"
                        placeholder="ada_lovelace"
                        value={usernameChoice}
                        onChange={(e) =>
                          setUsernameChoice(e.target.value.toLowerCase())
                        }
                      />
                    </div>
                  </div>
                )}
                {!hasExistingVault && (
                  <div className="onb-form">
                    <div className="field">
                      <label htmlFor="onb-vault-password">
                        Create a Vault password
                      </label>
                      <input
                        id="onb-vault-password"
                        className="input"
                        type="password"
                        minLength={12}
                        autoComplete="new-password"
                        placeholder="At least 12 characters"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="onb-vault-password-confirm">
                        Confirm Vault password
                      </label>
                      <input
                        id="onb-vault-password-confirm"
                        className="input"
                        type="password"
                        minLength={12}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(event) =>
                          setConfirmPassword(event.target.value)
                        }
                      />
                    </div>
                    <p className="fine-print">
                      Choose a different password from your sign-in password. It
                      unlocks your Vault locally and is never sent to Xenode or
                      your sign-in provider.
                    </p>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={trustBrowser}
                        onChange={(event) =>
                          setTrustBrowser(event.target.checked)
                        }
                      />
                      Trust this browser to unlock after later sign-ins. Leave
                      this unchecked on a shared device.
                    </label>
                  </div>
                )}
                <button
                  className="button button-block"
                  onClick={handleWelcomeContinue}
                >
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
                  This recovers your vault if you lose every trusted device and
                  passkey. Xenode can never see or reset it.
                </p>
                {kit ? (
                  <>
                    <ol className="onb-words" aria-hidden="true">
                      {kit.words.split(" ").map((word, i) => (
                        <li key={`${i}-${word}`} className="onb-word">
                          <span className="onb-word-n">{i + 1}</span>
                          <span className="onb-word-w">{word}</span>
                        </li>
                      ))}
                    </ol>
                    <label
                      className="onb-copy-phrase-label"
                      htmlFor="onb-copy-phrase"
                    >
                      Copy-ready phrase
                    </label>
                    <textarea
                      id="onb-copy-phrase"
                      className="onb-copy-phrase"
                      value={kit.words}
                      readOnly
                      rows={2}
                      spellCheck={false}
                      autoCapitalize="none"
                      autoCorrect="off"
                      onFocus={(event) => event.currentTarget.select()}
                      onClick={(event) => event.currentTarget.select()}
                    />
                  </>
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
                  <span>
                    I&rsquo;ve saved my recovery phrase somewhere safe
                  </span>
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
                <p className="lede">
                  Pick how Xenode looks. You can change it anytime.
                </p>
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
                <Globe className="onb-art" size={120} strokeWidth={1} />
                <p className="eyebrow">Storage region</p>
                <h1>Choose a storage pool</h1>
                <p className="lede">
                  Choose one of the configured storage pools —
                  <strong> this can&rsquo;t be changed later</strong>.
                </p>
                <div className="onb-themes onb-regions">
                  {storageRegions.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`onb-theme-card${
                        region === value ? " is-selected" : ""
                      }`}
                      onClick={() => setRegion(value)}
                    >
                      <span style={{ fontWeight: 600 }}>
                        {STORAGE_REGION_LABELS[value]}
                      </span>
                      <span className="fine-print" style={{ opacity: 0.7 }}>
                        {REGION_BLURB[value]}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  className="button button-block"
                  onClick={nextStep}
                  disabled={!region}
                >
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

            {step === 6 && (
              <motion.div
                key="step6"
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
                  Your encrypted vault will be created on this device and
                  unlocked automatically across Drive and Photos.
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

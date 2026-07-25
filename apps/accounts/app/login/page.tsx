"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { resumeAuthorizationPath } from "@/lib/presentation";

type Mode = "signin" | "signup";

const TAGLINES = [
  "One identity for Drive, Photos, and every Xenode product.",
  "End-to-end encrypted. Not even we can read your files.",
  "Host-only product sessions — revoke any device, anytime.",
];

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {off ? (
        <>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.5 18.5 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61" />
          <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </>
      ) : (
        <>
          <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
      style={{ animation: "acct-spin 0.8s linear infinite" }}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tagline, setTagline] = useState(0);

  useEffect(() => {
    const timer = setInterval(
      () => setTagline((index) => (index + 1) % TAGLINES.length),
      7000,
    );
    return () => clearInterval(timer);
  }, []);

  function switchMode(next: Mode) {
    setMode(next);
    setMessage("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    const resumePath = resumeAuthorizationPath(
      new URLSearchParams(window.location.search),
    );
    // Stash the just-entered password so vault setup can create the vault with
    // it silently — the user never types a password twice.
    const rememberPasswordForVault = () => {
      try {
        sessionStorage.setItem("xenode-vault-pw", password);
      } catch {
        /* private mode / storage disabled — vault will prompt instead */
      }
    };
    const goVerify = async (targetEmail: string) => {
      rememberPasswordForVault();
      await fetch("/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: targetEmail, type: "email-verification" }),
      }).catch(() => undefined);
      window.location.assign(
        `/verify-email?email=${encodeURIComponent(targetEmail)}&next=${encodeURIComponent(resumePath)}`,
      );
    };

    try {
      if (mode === "signin") {
        const isEmail = identifier.includes("@");
        const endpoint = isEmail
          ? "/api/auth/sign-in/email"
          : "/api/auth/sign-in/username";
        const body = isEmail
          ? { email: identifier.trim().toLowerCase(), password, rememberMe }
          : { username: identifier.trim().toLowerCase(), password, rememberMe };
        const response = await fetch(endpoint, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => ({}))) as {
            code?: string;
            message?: string;
          };
          // Correct credentials but unverified email → send them to verify.
          if (
            isEmail &&
            /verif/i.test(`${failure.code ?? ""} ${failure.message ?? ""}`)
          ) {
            await goVerify(identifier.trim().toLowerCase());
            return;
          }
          // Otherwise a generic response — never reveal whether the identity exists.
          setMessage("Those credentials didn't match. Please try again.");
          return;
        }
        window.location.assign(resumePath);
        return;
      }

      if (password !== confirm) {
        setMessage("Passwords do not match.");
        return;
      }
      const emailNormalized = email.trim().toLowerCase();
      const response = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: emailNormalized,
          username: username.trim().toLowerCase(),
          password,
        }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        const text = failure.message ?? "";
        setMessage(
          /exist|taken|duplicate|unique/i.test(text)
            ? "That email or username is already in use."
            : text || "Couldn't create your account. Please try again.",
        );
        return;
      }
      // New account: verify email (OTP) → vault setup → resume.
      await goVerify(emailNormalized);
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const isSignin = mode === "signin";

  return (
    <main className="auth-shell">
      <style>{"@keyframes acct-spin{to{transform:rotate(360deg)}}"}</style>

      <aside className="auth-brand-panel">
        <span className="brand-glow" aria-hidden="true" />
        <Link href="/" className="auth-brand-wordmark">
          Xenode
        </Link>
        <div className="auth-brand-copy">
          <p className="auth-brand-kicker">Xenode Account</p>
          <p className="auth-brand-tagline" key={tagline}>
            {TAGLINES[tagline]}
          </p>
        </div>
      </aside>

      <section className="auth-form-panel">
        <div className="auth-form-inner">
          <Link href="/" className="brand">
            <span className="brand-mark">X</span>
            <span className="brand-wordmark">Xenode</span>
          </Link>

          <h1 className="auth-heading">
            {isSignin ? "Welcome back" : "Create your account"}
          </h1>
          <p className="auth-sub">
            {isSignin
              ? "Sign in with your Xenode email or username. Connected external accounts can’t sign in here."
              : "One Xenode Account for Drive, Photos, and everything else. Your username is separate from your encryption keys."}
          </p>

          <form className="form" onSubmit={submit}>
            {!isSignin && (
              <div className="field">
                <label htmlFor="name">Full name</label>
                <input
                  className="input"
                  id="name"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ada Lovelace"
                />
              </div>
            )}

            {isSignin ? (
              <div className="field">
                <label htmlFor="identifier">Email or username</label>
                <input
                  className="input"
                  id="identifier"
                  autoCapitalize="none"
                  autoComplete="username"
                  required
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="you@example.com"
                />
              </div>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input
                    className="input"
                    id="email"
                    type="email"
                    autoCapitalize="none"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div className="field">
                  <label htmlFor="username">Username</label>
                  <input
                    className="input"
                    id="username"
                    autoCapitalize="none"
                    autoComplete="username"
                    required
                    minLength={3}
                    maxLength={30}
                    pattern="[a-zA-Z0-9_]+"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="ada_lovelace"
                  />
                </div>
              </>
            )}

            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="input-affix">
                <input
                  className="input"
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={isSignin ? 8 : 12}
                  autoComplete={isSignin ? "current-password" : "new-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="input-affix-button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  <EyeIcon off={showPassword} />
                </button>
              </div>
              {!isSignin && (
                <p className="fine-print">
                  At least 12 characters — this password also unlocks your
                  encrypted Vault.
                </p>
              )}
            </div>

            {!isSignin && (
              <div className="field">
                <label htmlFor="confirm">Confirm password</label>
                <input
                  className="input"
                  id="confirm"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={12}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder="••••••••"
                />
              </div>
            )}

            {isSignin && (
              <label className="checkbox-row" htmlFor="rememberMe">
                <input
                  id="rememberMe"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                />
                <span>Keep me signed in on this device</span>
              </label>
            )}

            {message && (
              <p className="status status-error" role="alert">
                {message}
              </p>
            )}

            <button className="button button-block" type="submit" disabled={busy}>
              {busy && <Spinner />}
              {busy
                ? isSignin
                  ? "Signing in…"
                  : "Creating account…"
                : isSignin
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>

          <p className="auth-switch">
            {isSignin ? "New to Xenode?" : "Already have an account?"}{" "}
            <button
              type="button"
              className="button-link"
              onClick={() => switchMode(isSignin ? "signup" : "signin")}
            >
              {isSignin ? "Create an account" : "Sign in"}
            </button>
          </p>

          {isSignin && (
            <p className="fine-print" style={{ marginTop: 18, textAlign: "center" }}>
              For your privacy, wrong email, username, and password attempts all
              get the same response.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

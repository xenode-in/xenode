"use client";

import { useEffect, useRef, useState } from "react";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60;

export default function VerifyEmailPage() {
  const [email, setEmail] = useState("");
  const [nextPath, setNextPath] = useState("/");
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const [message, setMessage] = useState("");
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const e = params.get("email");
    const n = params.get("next");
    if (e) setEmail(e);
    if (n && n.startsWith("/")) setNextPath(n);
    if (!e) window.location.assign("/login");
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  function setDigit(index: number, value: string) {
    // Handle a pasted full code.
    if (value.length > 1) {
      const chars = value.replace(/\D/gu, "").slice(0, OTP_LENGTH).split("");
      const next = Array(OTP_LENGTH).fill("");
      chars.forEach((c, i) => (next[i] = c));
      setDigits(next);
      inputs.current[Math.min(chars.length, OTP_LENGTH - 1)]?.focus();
      return;
    }
    const digit = value.replace(/\D/gu, "");
    setDigits((current) => {
      const next = [...current];
      next[index] = digit;
      return next;
    });
    if (digit && index < OTP_LENGTH - 1) inputs.current[index + 1]?.focus();
  }

  async function resend() {
    if (cooldown > 0 || !email) return;
    setMessage("");
    await fetch("/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, type: "email-verification" }),
    }).catch(() => undefined);
    setCooldown(RESEND_COOLDOWN);
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    const otp = digits.join("");
    if (otp.length < OTP_LENGTH) {
      setMessage("Enter the full 6-digit code.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/email-otp/verify-email", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, otp }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        setMessage(
          /expired/i.test(failure.message ?? "")
            ? "That code expired — request a new one."
            : "That code didn't match. Try again.",
        );
        setDigits(Array(OTP_LENGTH).fill(""));
        inputs.current[0]?.focus();
        return;
      }
      // Verified + auto-signed-in → continue to one-time vault setup, then on
      // to wherever the user was headed.
      window.location.assign(
        `/security/vault?next=${encodeURIComponent(nextPath)}`,
      );
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <p className="eyebrow">Xenode Account</p>
        <h1 style={{ fontSize: 28 }}>Verify your email</h1>
        <p className="lede" style={{ marginBottom: 24 }}>
          We sent a 6-digit code to{" "}
          <strong style={{ color: "var(--foreground)" }}>
            {email || "your email"}
          </strong>
          . Enter it below to finish setting up your account.
        </p>
        <form className="form" onSubmit={verify}>
          <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(element) => {
                  inputs.current[index] = element;
                }}
                className="input"
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                maxLength={index === 0 ? OTP_LENGTH : 1}
                value={digit}
                onChange={(event) => setDigit(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" && !digit && index > 0) {
                    inputs.current[index - 1]?.focus();
                  }
                }}
                style={{
                  textAlign: "center",
                  fontSize: 22,
                  fontFamily: "var(--font-mono)",
                  padding: 0,
                }}
                aria-label={`Digit ${index + 1}`}
              />
            ))}
          </div>
          {message ? (
            <p className="status status-error" role="alert">
              {message}
            </p>
          ) : null}
          <button className="button button-block" type="submit" disabled={busy}>
            {busy ? "Verifying…" : "Verify email"}
          </button>
        </form>
        <p className="auth-switch">
          Didn&rsquo;t get the code?{" "}
          <button
            type="button"
            className="button-link"
            onClick={() => void resend()}
            disabled={cooldown > 0}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
        </p>
      </section>
    </main>
  );
}

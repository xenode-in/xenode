"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  Laptop,
  Loader2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import type { CryptoEnvelope } from "@xenode/crypto-core";
import { loadBrowserDeviceArk } from "@/lib/device-vault";
import {
  cacheArkFromLogin,
  confirmVaultUnlock,
} from "@/lib/password-vault";

type VaultResponse = {
  accountId: string;
  vault: {
    deviceEnvelopes: CryptoEnvelope[];
  } | null;
};

export function VaultUnlockGate({
  accountId,
  accountLabel,
  next,
}: {
  accountId: string;
  accountLabel: string;
  next: string;
}) {
  const [phase, setPhase] = useState<"checking" | "password" | "unlocking">(
    "checking",
  );
  const [password, setPassword] = useState("");
  const [trustDevice, setTrustDevice] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const started = useRef(false);

  const continueToProduct = useCallback(() => {
    window.location.replace(next);
  }, [next]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const response = await fetch("/api/vault", {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Your Vault could not be loaded.");
        const data = (await response.json()) as VaultResponse;
        if (!data.vault || data.accountId !== accountId) {
          throw new Error("Your encrypted Vault is not ready.");
        }
        const ark = await loadBrowserDeviceArk(
          accountId,
          data.vault.deviceEnvelopes,
        );
        if (!ark) {
          setPhase("password");
          return;
        }
        await confirmVaultUnlock("trusted-device");
        continueToProduct();
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "This browser could not unlock your Vault.",
        );
        setPhase("password");
      }
    })();
  }, [accountId, continueToProduct]);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 12) {
      setError("Enter your Xenode password.");
      return;
    }
    setPhase("unlocking");
    setError("");
    try {
      await cacheArkFromLogin(password, { trustDevice });
      await confirmVaultUnlock("password", password);
      continueToProduct();
    } catch {
      setError("That password could not unlock this Vault. Please try again.");
      setPhase("password");
    }
  }

  const checking = phase === "checking";
  const busy = phase === "unlocking";

  return (
    <main className="auth-wrap">
      <section className="auth-card vault-unlock-card">
        <div className="vault-unlock-icon" aria-hidden="true">
          {checking ? (
            <Loader2 className="onb-spin" size={27} />
          ) : (
            <LockKeyhole size={27} />
          )}
        </div>
        <p className="eyebrow">Secure Vault</p>
        <h1>{checking ? "Checking this browser" : "Unlock your Vault"}</h1>
        <p className="lede">
          {checking
            ? "Looking for a trusted-device key before opening the requested Xenode product."
            : `You signed in as ${accountLabel}. Authentication is complete, but your encrypted files stay locked until this browser unlocks the Vault.`}
        </p>

        {checking ? (
          <div className="vault-unlock-checking" role="status">
            <span className="vault-unlock-pulse" />
            Checking for a trusted browser key…
          </div>
        ) : (
          <form className="form" onSubmit={(event) => void unlock(event)}>
            <div className="field">
              <label htmlFor="vault-unlock-password">Xenode password</label>
              <div className="input-affix">
                <input
                  id="vault-unlock-password"
                  className="input"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  minLength={12}
                  maxLength={128}
                  autoFocus
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  className="input-affix-button"
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((shown) => !shown)}
                >
                  {showPassword ? <Check size={17} /> : <LockKeyhole size={17} />}
                </button>
              </div>
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(event) => setTrustDevice(event.target.checked)}
              />
              <span>
                <strong className="vault-unlock-trust-title">
                  Trust this browser
                </strong>
                <small>
                  Unlock silently after future Google or GitHub sign-ins on
                  this browser. Do not use this on a shared device.
                </small>
              </span>
            </label>

            <button className="button button-block" type="submit" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="onb-spin" size={17} />
                  Unlocking locally…
                </>
              ) : (
                <>
                  <ShieldCheck size={17} />
                  Unlock and continue
                </>
              )}
            </button>
          </form>
        )}

        {error ? (
          <p className="status status-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="vault-unlock-footnote">
          <Laptop size={15} />
          <span>
            OAuth identifies you. Your password or trusted-device key unlocks
            encryption locally.
          </span>
        </div>
        {!checking ? (
          <Link className="back-link" href="/logout">
            Not your account? Sign out
          </Link>
        ) : null}
      </section>
    </main>
  );
}

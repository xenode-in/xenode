"use client";

import { useState } from "react";
import { confirmVaultUnlock, updateVaultPassword } from "@/lib/password-vault";

export function VaultPasswordForm({
  migrating,
  initialRecovery = false,
  onComplete,
}: {
  migrating: boolean;
  initialRecovery?: boolean;
  onComplete(): void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [useRecovery, setUseRecovery] = useState(initialRecovery);
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!saved && newPassword !== confirm) {
      setError("Vault passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    let committed = saved;
    try {
      if (!saved) {
        await updateVaultPassword({
          newPassword,
          ...(useRecovery ? { recoveryPhrase } : { currentPassword }),
        });
        committed = true;
        setSaved(true);
      }
      await confirmVaultUnlock(useRecovery ? "recovery" : "password");
      setCurrentPassword("");
      setRecoveryPhrase("");
      setNewPassword("");
      setConfirm("");
      onComplete();
    } catch (cause) {
      setError(
        committed
          ? "Your Vault password was saved. Try Continue again to finish local unlock."
          : cause instanceof Error
            ? cause.message
            : "Could not update your Vault password.",
      );
      setBusy(false);
    }
  }
  return (
    <form className="form" onSubmit={(event) => void submit(event)}>
      <p className="lede">
        {migrating
          ? "Your Vault previously used your sign-in password. Choose a different Vault password now. Your existing keys and files will be preserved."
          : "Change the password that opens your Vault locally. Your sign-in password will stay the same."}{" "}
        Your Vault password and recovery phrase never leave this browser.
      </p>
      <fieldset disabled={busy || saved} className="contents">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={useRecovery}
            onChange={(e) => {
              setUseRecovery(e.target.checked);
              setCurrentPassword("");
              setRecoveryPhrase("");
            }}
          />
          Use my recovery phrase
        </label>
        {useRecovery ? (
          <div className="field">
            <label htmlFor="vault-recovery-phrase">Recovery phrase</label>
            <textarea
              id="vault-recovery-phrase"
              className="input"
              required
              autoComplete="off"
              spellCheck={false}
              value={recoveryPhrase}
              onChange={(e) => setRecoveryPhrase(e.target.value)}
            />
          </div>
        ) : (
          <div className="field">
            <label htmlFor="vault-current-password">
              Current Vault password
              {migrating ? " (your previous sign-in password)" : ""}
            </label>
            <input
              id="vault-current-password"
              className="input"
              type="password"
              required
              autoComplete="off"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
        )}
        <div className="field">
          <label htmlFor="vault-new-password">
            New Vault password — different from sign-in
          </label>
          <input
            id="vault-new-password"
            className="input"
            type="password"
            required
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="vault-confirm-password">Confirm Vault password</label>
          <input
            id="vault-confirm-password"
            className="input"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
      </fieldset>
      {error ? (
        <p className="status status-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button button-block" disabled={busy}>
        {busy
          ? "Rewrapping locally…"
          : saved
            ? "Continue"
            : migrating
              ? "Separate Vault password and continue"
              : "Change Vault password"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2, LockKeyhole } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@xenode/ui";
export function PasswordChangeDialog({
  email,
  hasCredential,
  onStatus,
}: {
  accountId: string;
  email: string;
  hasCredential: boolean;
  onStatus: (message: string, error: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function change(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (newPassword !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    if (newPassword.length < 12 || newPassword.length > 128) {
      setError("Use a password between 12 and 128 characters.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/account/password/change", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          revokeOtherSessions,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          payload.error ?? "Could not change the sign-in password.",
        );
      setOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      onStatus(
        "Sign-in password changed. Your Vault password is unchanged.",
        false,
      );
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Could not change the password.";
      setError(message);
      onStatus(message, true);
    } finally {
      setBusy(false);
    }
  }

  if (!hasCredential) {
    return (
      <Button
        variant="outline"
        onClick={() =>
          window.location.assign(
            `/auth/password?next=${encodeURIComponent("/security")}`,
          )
        }
      >
        Create password
      </Button>
    );
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Change password
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change your password</DialogTitle>
            <DialogDescription>
              This changes the sign-in password for {email}. Use a password
              different from your Vault password; your encryption keys are
              unchanged.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={change}>
            <PasswordField
              id="current-password"
              label="Current sign-in password"
              value={currentPassword}
              show={show}
              autoComplete="current-password"
              onChange={setCurrentPassword}
            />
            <PasswordField
              id="new-password"
              label="New sign-in password"
              value={newPassword}
              show={show}
              autoComplete="new-password"
              onChange={setNewPassword}
            />
            <PasswordField
              id="confirm-password"
              label="Confirm new password"
              value={confirm}
              show={show}
              autoComplete="new-password"
              onChange={setConfirm}
            />
            <button
              type="button"
              className="flex items-center gap-2 text-sm text-muted-foreground"
              onClick={() => setShow((value) => !value)}
            >
              {show ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
              {show ? "Hide passwords" : "Show passwords"}
            </button>
            <label className="flex items-center gap-3 rounded-xl border p-3 text-sm">
              <input
                type="checkbox"
                checked={revokeOtherSessions}
                onChange={(event) =>
                  setRevokeOtherSessions(event.target.checked)
                }
              />
              Sign out other Accounts, Drive, and Photos sessions
            </label>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Button
              className="w-full"
              disabled={
                busy ||
                currentPassword.length < 12 ||
                newPassword.length < 12 ||
                confirm.length < 12
              }
            >
              {busy ? <Loader2 className="animate-spin" /> : <LockKeyhole />}
              {busy ? "Changing password…" : "Change password"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PasswordField({
  id,
  label,
  value,
  show,
  autoComplete,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  show: boolean;
  autoComplete: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        minLength={12}
        maxLength={128}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

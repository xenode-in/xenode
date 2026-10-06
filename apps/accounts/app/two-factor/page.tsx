"use client";

import { useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@xenode/ui";

export default function TwoFactorPage() {
  const [code, setCode] = useState("");
  const [method, setMethod] = useState<"totp" | "backup">("totp");
  // Skipping the second factor on this browser is an explicit choice.
  const [trustDevice, setTrustDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/two-factor/verify", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim(), method, trustDevice }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Verification failed.");
      const next =
        new URLSearchParams(window.location.search).get("next") || "/";
      window.location.assign(
        `/auth/continue?next=${encodeURIComponent(next)}`,
      );
    } catch (verifyError) {
      setError(
        verifyError instanceof Error
          ? verifyError.message
          : "Verification failed.",
      );
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-5 py-10">
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="text-center">
          <span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck />
          </span>
          <CardTitle className="text-2xl">Two-step verification</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            {method === "totp"
              ? "Enter the code from your authenticator app."
              : "Use one of your one-time backup codes."}
          </p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={verify}>
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode={method === "totp" ? "numeric" : "text"}
              autoComplete="one-time-code"
              aria-label={method === "totp" ? "Authenticator code" : "Backup code"}
              placeholder={method === "totp" ? "000000" : "Backup code"}
              className="h-12 text-center text-lg tracking-[0.22em]"
              required
              autoFocus
            />
            <label className="flex items-center gap-3 rounded-xl border p-3 text-sm">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(event) => setTrustDevice(event.target.checked)}
              />
              Trust this browser for 30 days
            </label>
            {error ? (
              <p className="text-sm text-destructive" role="alert">{error}</p>
            ) : null}
            <Button className="w-full" disabled={busy || code.trim().length < 6}>
              {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
              {busy ? "Verifying…" : "Verify and continue"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setMethod((value) => (value === "totp" ? "backup" : "totp"));
                setCode("");
                setError("");
              }}
            >
              {method === "totp"
                ? "Use a backup code"
                : "Use authenticator code"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

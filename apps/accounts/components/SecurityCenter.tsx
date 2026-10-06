"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import {
  Check,
  Copy,
  Fingerprint,
  KeyRound,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@xenode/ui";
import { authClient } from "@/lib/auth-client";
import { enrollAccountPasskey } from "@/lib/account-passkeys";
import { PasswordChangeDialog } from "@/components/security/PasswordChangeDialog";

type PasskeyItem = {
  id: string;
  name: string;
  credentialId: string;
  createdAt: string;
};
type LegacyPasskey = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
  }).format(new Date(value));
}

export function SecurityCenter({
  accountId,
  email,
  hasCredential,
  twoFactorEnabled,
  initialPasskeys,
  initialLegacy,
}: {
  accountId: string;
  email: string;
  hasCredential: boolean;
  twoFactorEnabled: boolean;
  initialPasskeys: PasskeyItem[];
  initialLegacy: LegacyPasskey[];
}) {
  const router = useRouter();
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>(initialPasskeys);
  const [legacy, setLegacy] = useState<LegacyPasskey[]>(initialLegacy);
  const [loadingPasskeys, setLoadingPasskeys] = useState(false);
  const [passkeyOpen, setPasskeyOpen] = useState(false);
  const [passkeyName, setPasskeyName] = useState("My passkey");
  const [passkeyPassword, setPasskeyPassword] = useState("");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);

  const totpSecret = useMemo(() => {
    try {
      return totpUri ? new URL(totpUri).searchParams.get("secret") ?? "" : "";
    } catch {
      return "";
    }
  }, [totpUri]);

  async function loadPasskeys() {
    const response = await fetch("/api/account/passkeys", {
      credentials: "include",
      cache: "no-store",
    });
    if (response.ok) {
      const payload = (await response.json()) as {
        passkeys: PasskeyItem[];
        legacy: LegacyPasskey[];
      };
      setPasskeys(payload.passkeys);
      setLegacy(payload.legacy);
    }
    setLoadingPasskeys(false);
  }

  async function addPasskey(event: React.FormEvent) {
    event.preventDefault();
    setPasskeyBusy(true);
    setError(false);
    setStatus("");
    try {
      await enrollAccountPasskey({
        password: passkeyPassword,
        name: passkeyName,
      });
      setPasskeyOpen(false);
      setPasskeyPassword("");
      setStatus("Passkey added. It can sign in and unlock your Vault.");
      await loadPasskeys();
    } catch (addError) {
      setError(true);
      setStatus(
        addError instanceof Error ? addError.message : "Could not add passkey.",
      );
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function removePasskey(id: string) {
    setPasskeyBusy(true);
    setStatus("");
    const response = await fetch(
      `/api/account/passkeys?id=${encodeURIComponent(id)}`,
      { method: "DELETE", credentials: "include" },
    );
    setPasskeyBusy(false);
    if (!response.ok) {
      setError(true);
      setStatus("Could not remove that passkey.");
      return;
    }
    setStatus("Passkey removed.");
    await loadPasskeys();
  }

  async function renamePasskey(passkey: PasskeyItem) {
    const name = window.prompt("Name this passkey", passkey.name)?.trim();
    if (!name || name === passkey.name) return;
    const result = await authClient.passkey.updatePasskey({
      id: passkey.id,
      name: name.slice(0, 64),
    });
    if (result.error) {
      setError(true);
      setStatus(result.error.message ?? "Could not rename that passkey.");
      return;
    }
    setError(false);
    setStatus("Passkey renamed.");
    await loadPasskeys();
  }

  async function removeLegacyPasskey(id: string) {
    const response = await fetch(
      `/api/vault/passkeys?credentialId=${encodeURIComponent(id)}`,
      { method: "DELETE", credentials: "include" },
    );
    if (response.ok) {
      setStatus("Older Vault passkey removed.");
      await loadPasskeys();
    }
  }

  async function beginTwoFactor(event: React.FormEvent) {
    event.preventDefault();
    setTwoFactorBusy(true);
    setError(false);
    setStatus("");
    const result = await authClient.twoFactor.enable({
      password: twoFactorPassword,
      issuer: "Xenode Accounts",
    });
    setTwoFactorBusy(false);
    if (result.error || !result.data || result.data.method !== "totp") {
      setError(true);
      setStatus(result.error?.message ?? "Could not start authenticator setup.");
      return;
    }
    setTotpUri(result.data.totpURI);
    setBackupCodes(result.data.backupCodes);
  }

  async function verifyEnrollment(event: React.FormEvent) {
    event.preventDefault();
    setTwoFactorBusy(true);
    const result = await authClient.twoFactor.verifyTotp({
      code: totpCode.trim(),
    });
    setTwoFactorBusy(false);
    if (result.error) {
      setError(true);
      setStatus(result.error.message ?? "That code is not valid.");
      return;
    }
    setStatus("Authenticator verification is now enabled.");
    setTwoFactorOpen(false);
    setTwoFactorPassword("");
    setTotpUri("");
    setTotpCode("");
    router.refresh();
  }

  async function disableTwoFactor() {
    const password = window.prompt(
      "Enter your sign-in password to disable authenticator verification.",
    );
    if (!password) return;
    setTwoFactorBusy(true);
    const result = await authClient.twoFactor.disable({ password });
    setTwoFactorBusy(false);
    if (result.error) {
      setError(true);
      setStatus(result.error.message ?? "Could not disable verification.");
      return;
    }
    await fetch("/api/account/two-factor/trusted", {
      method: "DELETE",
      credentials: "include",
    }).catch(() => undefined);
    setStatus("Authenticator verification disabled.");
    router.refresh();
  }

  async function regenerateBackupCodes() {
    const password = window.prompt(
      "Enter your sign-in password to replace your backup codes.",
    );
    if (!password) return;
    const result = await authClient.twoFactor.generateBackupCodes({ password });
    if (result.error || !result.data) {
      setError(true);
      setStatus(result.error?.message ?? "Could not replace backup codes.");
      return;
    }
    setBackupCodes(result.data.backupCodes);
    setTotpUri("");
    setTwoFactorOpen(true);
  }

  return (
    <div className="space-y-5">
      {status ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            error
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
          }`}
          role="status"
        >
          {status}
        </div>
      ) : null}

      <Card className="bg-card/80 backdrop-blur">
        <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="mb-3 grid size-11 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
              <Fingerprint />
            </span>
            <CardTitle>Passkeys</CardTitle>
            <CardDescription className="mt-2 max-w-xl leading-6">
              Use your fingerprint, face, device PIN, or security key to sign in
              and unlock the encrypted Vault.
            </CardDescription>
          </div>
          <Button onClick={() => setPasskeyOpen(true)}>
            <Plus />
            Add passkey
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingPasskeys ? (
            <p className="text-sm text-muted-foreground">Loading passkeys…</p>
          ) : passkeys.length ? (
            passkeys.map((passkey) => (
              <div
                key={passkey.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
              >
                <div>
                  <p className="font-medium">{passkey.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Added {dateLabel(passkey.createdAt)} · Sign-in + Vault
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={passkeyBusy}
                    onClick={() => void renamePasskey(passkey)}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={passkeyBusy}
                    onClick={() => void removePasskey(passkey.id)}
                  >
                    <Trash2 />
                    Remove
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
              No combined passkeys yet. Your password and recovery phrase remain
              available.
            </div>
          )}
          {legacy.length ? (
            <div className="rounded-xl bg-muted/55 p-4">
              <p className="text-sm font-medium">Older Vault-only passkeys</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Replace these with a combined passkey when convenient.
              </p>
              {legacy.map((item) => (
                <div
                  key={item.id}
                  className="mt-3 flex items-center justify-between gap-3"
                >
                  <span className="text-sm">{item.name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void removeLegacyPasskey(item.id)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="bg-card/80 backdrop-blur">
        <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="mb-3 grid size-11 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600">
              <ShieldCheck />
            </span>
            <div className="flex items-center gap-2">
              <CardTitle>Authenticator app</CardTitle>
              <Badge variant={twoFactorEnabled ? "default" : "secondary"}>
                {twoFactorEnabled ? "Enabled" : "Off"}
              </Badge>
            </div>
            <CardDescription className="mt-2 max-w-xl leading-6">
              Require a rotating code after password, Google, or GitHub sign-in.
              Passkeys remain your phishing-resistant shortcut.
            </CardDescription>
          </div>
          {twoFactorEnabled ? (
            <Button
              variant="outline"
              disabled={twoFactorBusy}
              onClick={() => void disableTwoFactor()}
            >
              Disable
            </Button>
          ) : (
            <Button onClick={() => setTwoFactorOpen(true)}>Set up</Button>
          )}
        </CardHeader>
        {twoFactorEnabled ? (
          <CardContent>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void regenerateBackupCodes()}
            >
              <RefreshCw />
              Replace backup codes
            </Button>
          </CardContent>
        ) : null}
      </Card>

      <Card className="bg-card/80 backdrop-blur">
        <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="mb-3 grid size-11 place-items-center rounded-xl bg-violet-500/10 text-violet-600">
              <LockKeyhole />
            </span>
            <CardTitle>Password</CardTitle>
            <CardDescription className="mt-2 max-w-xl leading-6">
              Your sign-in password and local Vault password are separate.
              Changing your sign-in password does not change your encryption keys.
            </CardDescription>
          </div>
          <PasswordChangeDialog
            accountId={accountId}
            email={email}
            hasCredential={hasCredential}
            onStatus={(message, isError) => {
              setStatus(message);
              setError(isError);
            }}
          />
        </CardHeader>
        <CardContent><Button variant="outline" asChild><a href="/security/vault">Change Vault password</a></Button></CardContent>
      </Card>

      <Dialog open={passkeyOpen} onOpenChange={setPasskeyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a passkey</DialogTitle>
            <DialogDescription>
              Enter your Vault password so this browser can rewrap the Vault key for
              the new passkey. The key never leaves this device.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={addPasskey}>
            <div className="grid gap-2">
              <Label htmlFor="passkey-name">Passkey name</Label>
              <Input
                id="passkey-name"
                value={passkeyName}
                maxLength={64}
                onChange={(event) => setPasskeyName(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="passkey-password">Vault password (local only)</Label>
              <Input
                id="passkey-password"
                type="password"
                autoComplete="current-password"
                minLength={12}
                value={passkeyPassword}
                onChange={(event) => setPasskeyPassword(event.target.value)}
              />
            </div>
            <Button
              className="w-full"
              disabled={passkeyBusy || passkeyPassword.length < 12}
            >
              {passkeyBusy ? <Loader2 className="animate-spin" /> : <Fingerprint />}
              {passkeyBusy ? "Adding passkey…" : "Continue with this device"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={twoFactorOpen}
        onOpenChange={(open) => {
          setTwoFactorOpen(open);
          if (!open) {
            setTotpUri("");
            setTotpCode("");
            setTwoFactorPassword("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {totpUri
                ? "Connect your authenticator"
                : backupCodes.length
                  ? "New backup codes"
                  : "Set up an authenticator"}
            </DialogTitle>
            <DialogDescription>
              {totpUri
                ? "Scan the QR code, then enter the current six-digit code."
                : backupCodes.length
                  ? "Save these codes now. Each code can be used once."
                  : "Confirm your password before creating the authenticator secret."}
            </DialogDescription>
          </DialogHeader>
          {backupCodes.length && !totpUri ? (
            <BackupCodes codes={backupCodes} />
          ) : totpUri ? (
            <form className="space-y-4" onSubmit={verifyEnrollment}>
              <div className="mx-auto w-fit rounded-2xl bg-white p-4">
                <QRCode value={totpUri} size={184} />
              </div>
              <div className="rounded-xl bg-muted p-3 text-center font-mono text-xs break-all">
                {totpSecret}
              </div>
              <BackupCodes codes={backupCodes} compact />
              <Input
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label="Authenticator code"
                placeholder="000000"
                className="text-center text-lg tracking-[0.22em]"
                minLength={6}
                required
              />
              <Button className="w-full" disabled={twoFactorBusy}>
                {twoFactorBusy ? <Loader2 className="animate-spin" /> : <Check />}
                Verify and enable
              </Button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={beginTwoFactor}>
              <div className="grid gap-2">
                <Label htmlFor="two-factor-password">Sign-in password</Label>
                <Input
                  id="two-factor-password"
                  type="password"
                  autoComplete="current-password"
                  minLength={12}
                  value={twoFactorPassword}
                  onChange={(event) => setTwoFactorPassword(event.target.value)}
                />
              </div>
              <Button
                className="w-full"
                disabled={twoFactorBusy || twoFactorPassword.length < 12}
              >
                {twoFactorBusy ? <Loader2 className="animate-spin" /> : <KeyRound />}
                Continue
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BackupCodes({
  codes,
  compact = false,
}: {
  codes: string[];
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={compact ? "rounded-xl border p-3" : "space-y-4"}>
      <div className="grid grid-cols-2 gap-2 font-mono text-xs">
        {codes.map((code) => (
          <span key={code} className="rounded-md bg-muted px-2 py-1.5 text-center">
            {code}
          </span>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3 w-full"
        onClick={() => {
          void navigator.clipboard.writeText(codes.join("\n"));
          setCopied(true);
        }}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy backup codes"}
      </Button>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Clock3,
  HardDrive,
  Laptop,
  Monitor,
  MoreVertical,
  Smartphone,
  Tablet,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
} from "@xenode/ui";
import type {
  AccountDevice,
  DeviceKind,
} from "@/lib/device-sessions";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

function DeviceIcon({ kind }: { kind: DeviceKind }) {
  const className = "size-8";
  if (kind === "mobile") return <Smartphone className={className} />;
  if (kind === "tablet") return <Tablet className={className} />;
  if (kind === "desktop") return <Monitor className={className} />;
  return <Laptop className={className} />;
}

function productName(productId: string) {
  if (productId === "drive") return "Drive";
  if (productId === "photos") return "Photos";
  return productId.charAt(0).toUpperCase() + productId.slice(1);
}

function DeviceCard({
  device,
  busy,
  onRevoke,
}: {
  device: AccountDevice;
  busy: boolean;
  onRevoke: (deviceId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(device.isCurrent);
  const activeProducts = [
    ...new Set(
      device.productAccess
        .filter((access) => !access.revokedAt)
        .map((access) => productName(access.productId)),
    ),
  ];

  return (
    <Card className="gap-0 overflow-hidden rounded-2xl border-border/80 py-0 shadow-none">
      <div className="grid md:grid-cols-[220px_1fr]">
        <div className="flex gap-4 border-b border-border/70 bg-muted/30 p-5 md:min-h-48 md:flex-col md:border-r md:border-b-0 md:p-6">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm md:size-20">
            <DeviceIcon kind={device.kind} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{device.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {device.browser}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {activeProducts.map((product) => (
                <Badge
                  key={product}
                  variant="outline"
                  className="bg-background/75"
                >
                  {product}
                </Badge>
              ))}
              {!activeProducts.length ? (
                <Badge variant="outline">Accounts only</Badge>
              ) : null}
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-start justify-between gap-4 p-5 md:p-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">{device.platform}</h3>
                {device.isCurrent ? (
                  <Badge className="gap-1 bg-primary/12 text-primary hover:bg-primary/12">
                    <Check /> Current device
                  </Badge>
                ) : device.isActive ? (
                  <Badge
                    variant="secondary"
                    className="bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                  >
                    Active
                  </Badge>
                ) : (
                  <Badge variant="outline">Expired</Badge>
                )}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Last activity {formatDate(device.lastActiveAt)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Signed in {formatDate(device.createdAt)}
              </p>
            </div>

            {!device.isCurrent && device.isActive ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Sign out ${device.title}`}
                  >
                    <MoreVertical />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogMedia>
                      <AlertTriangle />
                    </AlertDialogMedia>
                    <AlertDialogTitle>
                      Sign out this device?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This ends its Xenode Accounts session and revokes its
                      active Drive and Photos access. Files and encrypted data
                      are not deleted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep signed in</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void onRevoke(device.deviceId)}
                    >
                      {busy ? "Signing out…" : "Sign out device"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </div>

          <div className="border-t border-border/70">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left text-sm font-medium transition hover:bg-muted/45 md:px-6"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              <span>
                {device.productAccess.length
                  ? `${device.productAccess.length} product ${
                      device.productAccess.length === 1 ? "session" : "sessions"
                    }`
                  : "No product sessions"}
              </span>
              <ChevronDown
                className={`size-4 text-muted-foreground transition-transform ${
                  open ? "rotate-180" : ""
                }`}
              />
            </button>

            {open ? (
              <div className="border-t border-border/70 bg-muted/20 px-5 py-2 md:px-6">
                {device.productAccess.length ? (
                  device.productAccess.map((access) => (
                    <div
                      key={access.sessionId}
                      className="flex items-center gap-3 border-b border-border/60 py-3.5 last:border-b-0"
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
                        <HardDrive className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">
                            Xenode {productName(access.productId)}
                          </span>
                          <Badge
                            variant="outline"
                            className={
                              access.revokedAt
                                ? "text-muted-foreground"
                                : "border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                            }
                          >
                            {access.revokedAt ? "Revoked" : "Active"}
                          </Badge>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          Authorized {formatDate(access.authenticatedAt)}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="py-4 text-sm text-muted-foreground">
                    This browser is signed into Accounts but has not opened
                    Drive or Photos.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function DevicesList({
  initialDevices,
}: {
  initialDevices: AccountDevice[];
}) {
  const [devices, setDevices] = useState(initialDevices);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [everywhereBusy, setEverywhereBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const activeDevices = useMemo(
    () => devices.filter((device) => device.isActive),
    [devices],
  );
  const recentDevices = useMemo(
    () => devices.filter((device) => !device.isActive),
    [devices],
  );

  async function revokeDevice(deviceId: string) {
    setBusy(deviceId);
    setError("");
    const response = await fetch("/api/account/devices", {
      method: "DELETE",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    setBusy(null);
    if (!response.ok) {
      setError("We could not sign out that device. Please try again.");
      return;
    }
    setDevices((current) =>
      current.map((device) =>
        device.deviceId === deviceId
          ? {
              ...device,
              isActive: false,
              productAccess: device.productAccess.map((access) => ({
                ...access,
                revokedAt: access.revokedAt ?? new Date().toISOString(),
              })),
            }
          : device,
      ),
    );
  }

  async function signOutEverywhere() {
    setEverywhereBusy(true);
    setError("");
    const response = await fetch("/api/account/sign-out-everywhere", {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) {
      setEverywhereBusy(false);
      setError("We could not sign out every device. Please try again.");
      return;
    }
    const payload = (await response.json()) as { logoutUrl?: string };
    window.location.assign(payload.logoutUrl ?? "/logout");
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/security"
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Security
      </Link>

      <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] text-primary uppercase">
            Account security
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
            Your devices
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            Browsers signed into your Xenode account are shown once. Drive and
            Photos access is grouped inside the device that authorized it.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-sm text-muted-foreground shadow-sm">
          <Clock3 className="size-4" />
          {activeDevices.length} active{" "}
          {activeDevices.length === 1 ? "device" : "devices"}
        </div>
      </div>

      {error ? (
        <div
          className="mt-6 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          <AlertTriangle className="size-4" />
          {error}
        </div>
      ) : null}

      <section className="mt-8 space-y-4" aria-label="Signed-in devices">
        {activeDevices.length ? (
          activeDevices.map((device) => (
            <DeviceCard
              key={device.deviceId}
              device={device}
              busy={busy === device.deviceId}
              onRevoke={revokeDevice}
            />
          ))
        ) : (
          <Card className="items-center rounded-2xl px-6 py-12 text-center shadow-none">
            <Laptop className="size-9 text-muted-foreground" />
            <div>
              <h2 className="font-semibold">No devices to show</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your active browser sessions will appear here.
              </p>
            </div>
          </Card>
        )}
      </section>

      {recentDevices.length ? (
        <section className="mt-6" aria-label="Recent signed-out devices">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-4 rounded-xl border bg-card px-5 py-4 text-left transition hover:bg-muted/45"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((value) => !value)}
          >
            <span>
              <span className="block text-sm font-semibold">
                Recent signed-out devices
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {recentDevices.length} from the last 28 days
              </span>
            </span>
            <ChevronDown
              className={`size-4 text-muted-foreground transition-transform ${
                showHistory ? "rotate-180" : ""
              }`}
            />
          </button>
          {showHistory ? (
            <div className="mt-4 space-y-4">
              {recentDevices.map((device) => (
                <DeviceCard
                  key={device.deviceId}
                  device={device}
                  busy={busy === device.deviceId}
                  onRevoke={revokeDevice}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mt-10 flex flex-col gap-4 rounded-2xl border border-destructive/20 bg-destructive/[0.035] p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
        <div>
          <h2 className="font-semibold">Don&apos;t recognize a device?</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
            Sign out everywhere to revoke every browser, trusted-browser Vault
            envelope, and active product session—including this one.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="shrink-0">
              Sign out everywhere
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia>
                <AlertTriangle />
              </AlertDialogMedia>
              <AlertDialogTitle>Sign out every device?</AlertDialogTitle>
              <AlertDialogDescription>
                You will need to unlock your encrypted Vault again when you
                return. This does not delete any files.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={everywhereBusy}
                onClick={() => void signOutEverywhere()}
              >
                {everywhereBusy ? "Signing out…" : "Sign out everywhere"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </div>
  );
}

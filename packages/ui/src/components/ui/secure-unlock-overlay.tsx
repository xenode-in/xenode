"use client";

import { LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";

export interface SecureUnlockOverlayProps {
  productName: string;
  status: string;
  brokerUrl?: string | null;
  error?: boolean;
  onRetry?: () => void;
}

export function SecureUnlockOverlay({
  productName,
  status,
  brokerUrl,
  error = false,
  onRetry,
}: SecureUnlockOverlayProps) {
  return (
    <div
      className="fixed inset-0 z-[200] grid min-h-dvh place-items-center overflow-auto bg-background/95 px-4 py-8 backdrop-blur-2xl"
      aria-busy={!error}
      aria-live="polite"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(circle at 20% 15%, color-mix(in srgb, var(--primary) 12%, transparent), transparent 34%), radial-gradient(circle at 82% 78%, color-mix(in srgb, var(--primary) 8%, transparent), transparent 30%)",
        }}
      />

      <div className="relative w-full max-w-[560px]">
        <div className="mb-5 flex items-center justify-center gap-2 text-sm font-semibold tracking-tight text-foreground">
          <span className="font-brand text-xl italic">Xenode</span>
          <span className="h-4 w-px bg-border" />
          <span>{productName}</span>
        </div>

        {brokerUrl ? (
          <iframe
            src={brokerUrl}
            title={`Securely unlock Xenode ${productName}`}
            className="h-[560px] w-full rounded-[28px] border border-border bg-card shadow-[0_28px_90px_rgba(0,0,0,0.18)]"
            sandbox="allow-forms allow-same-origin allow-scripts"
            referrerPolicy="no-referrer"
          />
        ) : (
          <section className="overflow-hidden rounded-[28px] border border-border bg-card p-8 text-center shadow-[0_28px_90px_rgba(0,0,0,0.18)] sm:p-10">
            <div className="relative mx-auto mb-6 grid size-20 place-items-center rounded-3xl border border-primary/15 bg-primary/8 text-primary">
              <div className="absolute inset-0 animate-ping rounded-3xl border border-primary/10 [animation-duration:2.4s]" />
              {error ? (
                <LockKeyhole className="size-8" strokeWidth={1.8} />
              ) : (
                <ShieldCheck className="size-9" strokeWidth={1.7} />
              )}
            </div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              End-to-end encrypted
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {error
                ? `Couldn’t unlock ${productName}`
                : `Opening ${productName}`}
            </h1>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
              {status}
            </p>
            {!error ? (
              <div className="mx-auto mt-7 flex w-fit items-center gap-1.5">
                {[0, 1, 2].map((index) => (
                  <span
                    key={index}
                    className="size-1.5 animate-pulse rounded-full bg-primary"
                    style={{ animationDelay: `${index * 180}ms` }}
                  />
                ))}
              </div>
            ) : onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="mx-auto mt-7 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                <RefreshCw className="size-4" />
                Try again
              </button>
            ) : null}
          </section>
        )}

        <p className="mx-auto mt-5 flex max-w-md items-center justify-center gap-2 text-center text-xs leading-5 text-muted-foreground">
          <LockKeyhole className="size-3.5 shrink-0" />
          Your account root key stays inside Xenode Accounts. Only a one-time
          encrypted product key is delivered.
        </p>
      </div>
    </div>
  );
}

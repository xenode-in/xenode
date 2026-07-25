"use client";

import type { ReactNode } from "react";
import { Button, cn } from "@xenode/ui";

const ACCOUNTS_ORIGIN =
  process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in";
const DRIVE_ORIGIN = process.env.NEXT_PUBLIC_DRIVE_ORIGIN ?? "https://xenode.in";

export function PhotosShell({
  view,
  onView,
  actions,
  children,
}: {
  view: "timeline" | "albums";
  onView(view: "timeline" | "albums"): void;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <nav className="flex items-center gap-2 border-b border-border bg-card/60 px-6 py-3 backdrop-blur">
        <span className="font-brand text-xl text-primary mr-4">Xenode Photos</span>
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
          {(["timeline", "albums"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => onView(tab)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                view === tab
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <Button variant="ghost" size="sm" asChild>
            <a href={DRIVE_ORIGIN}>Drive</a>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href={ACCOUNTS_ORIGIN}>Account</a>
          </Button>
        </div>
      </nav>
      <div className="p-6">{children}</div>
    </main>
  );
}

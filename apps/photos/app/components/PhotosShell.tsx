"use client";

import type { ReactNode } from "react";
import {
  Album,
  Cloud,
  HelpCircle,
  Images,
  Search,
  Settings,
  Sparkles,
  UserRound,
} from "lucide-react";
import { Button, cn } from "@xenode/ui";

const ACCOUNTS_ORIGIN =
  process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in";
const DRIVE_ORIGIN = process.env.NEXT_PUBLIC_DRIVE_ORIGIN ?? "https://xenode.in";

export function PhotosShell({
  view,
  onView,
  search,
  onSearch,
  actions,
  children,
}: {
  view: "timeline" | "albums";
  onView(view: "timeline" | "albums"): void;
  search: string;
  onSearch(value: string): void;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border/70 bg-background/90 px-4 backdrop-blur-xl lg:px-6">
        <button
          type="button"
          onClick={() => onView("timeline")}
          className="flex min-w-fit items-center gap-2 rounded-xl pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open Photos"
        >
          <span className="relative grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/20">
            <Images className="size-5" />
            <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-400" />
          </span>
          <span className="hidden text-lg font-semibold tracking-tight sm:block">
            Xenode <span className="font-normal text-muted-foreground">Photos</span>
          </span>
        </button>

        <div className="relative mx-auto w-full max-w-2xl">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search your photos"
            className="h-11 w-full rounded-full border border-transparent bg-muted/80 pl-11 pr-4 text-sm outline-none transition focus:border-primary/30 focus:bg-card focus:ring-4 focus:ring-primary/10"
            aria-label="Search photos"
          />
        </div>

        <div className="flex min-w-fit items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="hidden rounded-full md:inline-flex"
            aria-label="Help"
          >
            <HelpCircle />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden rounded-full md:inline-flex"
            aria-label="Settings"
          >
            <Settings />
          </Button>
          <Button variant="outline" size="icon" className="rounded-full" asChild>
            <a href={ACCOUNTS_ORIGIN} aria-label="Open Xenode Account">
              <UserRound />
            </a>
          </Button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1920px]">
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 flex-col border-r border-border/60 bg-background px-3 py-5 md:flex">
          <nav className="space-y-1" aria-label="Photos navigation">
            <SideNavItem
              active={view === "timeline"}
              icon={<Images />}
              label="Photos"
              onClick={() => onView("timeline")}
            />
            <SideNavItem
              active={view === "albums"}
              icon={<Album />}
              label="Albums"
              onClick={() => onView("albums")}
            />
          </nav>

          <div className="mt-6 rounded-2xl border border-primary/10 bg-primary/[0.04] p-4">
            <div className="mb-3 grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </div>
            <p className="text-sm font-semibold">Your private memories</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Photos stay end-to-end encrypted and organized in your Photos
              Space.
            </p>
          </div>

          <div className="mt-auto space-y-1 border-t border-border/60 pt-4">
            <Button variant="ghost" className="w-full justify-start rounded-xl" asChild>
              <a href={DRIVE_ORIGIN}>
                <Cloud className="mr-2 size-4" />
                Open Drive
              </a>
            </Button>
            <Button variant="ghost" className="w-full justify-start rounded-xl" asChild>
              <a href={ACCOUNTS_ORIGIN}>
                <UserRound className="mr-2 size-4" />
                Account
              </a>
            </Button>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="border-b border-border/50 bg-background/80 px-4 py-3 md:hidden">
            <div className="flex rounded-xl bg-muted p-1">
              {(["timeline", "albums"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => onView(tab)}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-2 text-sm font-medium capitalize transition",
                    view === tab
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground",
                  )}
                >
                  {tab === "timeline" ? "Photos" : "Albums"}
                </button>
              ))}
            </div>
          </div>

          <section className="px-4 py-6 sm:px-6 lg:px-8">
            <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary/70">
                  Private library
                </p>
                <h1 className="text-3xl font-semibold tracking-tight">
                  {view === "timeline" ? "Photos" : "Albums"}
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">{actions}</div>
            </div>
            {children}
          </section>
        </div>
      </div>
    </main>
  );
}

function SideNavItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-11 w-full items-center gap-3 rounded-xl px-4 text-sm font-medium transition-colors [&_svg]:size-4",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

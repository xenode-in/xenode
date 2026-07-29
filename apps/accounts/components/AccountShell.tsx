"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  BarChart3,
  Building2,
  ChevronDown,
  Cloud,
  Grid2X2,
  HardDrive,
  Laptop,
  Link2,
  Menu,
  Moon,
  ShieldCheck,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@xenode/ui";
import { SignOutButton } from "@/components/SignOutButton";

const links = [
  { label: "Overview", href: "/", icon: Grid2X2 },
  { label: "Profile", href: "/profile", icon: UserRound },
  { label: "Connections", href: "/linked-accounts", icon: Link2 },
  { label: "Security", href: "/security", icon: ShieldCheck },
  { label: "Devices", href: "/devices", icon: Laptop },
  { label: "Organizations", href: "/organizations", icon: Building2 },
  { label: "Usage", href: "/usage", icon: BarChart3 },
] as const;

const driveOrigin =
  process.env.NEXT_PUBLIC_DRIVE_ORIGIN ??
  (process.env.NODE_ENV === "production"
    ? "https://xenode.in"
    : "http://localhost:3000");
const photosOrigin =
  process.env.NEXT_PUBLIC_PHOTOS_ORIGIN ??
  (process.env.NODE_ENV === "production"
    ? "https://photos.xenode.in"
    : "http://localhost:3002");

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      className="rounded-full"
      aria-label={dark ? "Use light theme" : "Use dark theme"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

function activePath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AccountShell({
  user,
  children,
}: {
  user: { name: string; email: string; image?: string | null };
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-background text-foreground">
      <div className="theme-gradient-background fixed inset-0 -z-20" />
      <div className="pointer-events-none fixed inset-0 -z-10 flex justify-center px-5 md:px-8">
        <div className="h-full w-full max-w-[1200px] border-x border-border/65" />
      </div>
      <div
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.035] dark:opacity-[0.07]"
        style={{ backgroundImage: "url('/grain.png')" }}
      />

      <header className="sticky top-0 z-50 border-b border-border/80 bg-background/82 px-5 backdrop-blur-xl md:px-8">
        <div className="mx-auto flex h-18 w-full max-w-[1200px] items-center justify-between border-x border-border/65 px-4 md:h-20 md:px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="font-brand text-2xl italic tracking-tight md:text-3xl">
                Xenode
              </span>
              <span className="text-sm font-semibold text-muted-foreground">
                Accounts
              </span>
            </Link>
            <span className="hidden h-5 w-px bg-border lg:block" />
            <nav
              className="hidden items-center gap-1 lg:flex"
              aria-label="Account navigation"
            >
              {links.slice(0, 4).map(({ label, href }) => {
                const active = activePath(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden gap-2 md:inline-flex"
                >
                  <Cloud />
                  Products
                  <ChevronDown className="size-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Xenode products</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href={`${driveOrigin}/dashboard`}>
                    <HardDrive /> Drive
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={`${photosOrigin}/library`}>
                    <Grid2X2 /> Photos
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <ThemeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-11 rounded-full px-1.5 md:pr-3"
                >
                  <Avatar className="size-8 border">
                    {user.image ? (
                      <AvatarImage src={user.image} alt="" />
                    ) : null}
                    <AvatarFallback>{initial}</AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-32 truncate text-sm md:inline">
                    {user.name || user.email}
                  </span>
                  <ChevronDown className="hidden size-3.5 opacity-60 md:block" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>
                  <span className="block truncate">{user.name}</span>
                  <span className="block truncate text-xs font-normal text-muted-foreground">
                    {user.email}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile">
                    <UserRound /> Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/devices">
                    <Laptop /> Devices
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <SignOutButton className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm text-destructive transition hover:bg-destructive/10" />
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Toggle account navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((open) => !open)}
            >
              {mobileOpen ? <X /> : <Menu />}
            </Button>
          </div>
        </div>

        {mobileOpen ? (
          <nav
            className="mx-auto grid w-full max-w-[1200px] grid-cols-2 gap-1 border-x border-t border-border/65 bg-background/95 p-3 shadow-xl backdrop-blur-xl sm:grid-cols-4 lg:hidden"
            aria-label="Mobile account navigation"
          >
            {links.map(({ label, href, icon: Icon }) => {
              const active = activePath(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium ${
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4" />
                  {label}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </header>

      <div className="relative">{children}</div>
    </div>
  );
}

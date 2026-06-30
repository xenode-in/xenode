"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  Files,
  LayoutDashboard,
  Menu,
  Settings,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface OrganizationWorkspaceShellProps {
  children: React.ReactNode;
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  org?: {
    id: string;
    name: string;
    role?: string;
  } | null;
  title?: string;
  description?: string;
}

function userInitials(user: OrganizationWorkspaceShellProps["user"]): string {
  const source = user.name || user.email || "U";
  return source
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function NavItems({ orgId }: { orgId?: string }) {
  const pathname = usePathname();
  const items = [
    { label: "Workspaces", href: "/organizations", icon: Building2 },
    ...(orgId
      ? [
          {
            label: "Overview",
            href: `/organizations/${orgId}`,
            icon: LayoutDashboard,
          },
          { label: "Files", href: `/organizations/${orgId}/files`, icon: Files },
          { label: "Members", href: "/organizations", icon: Users },
          {
            label: "Settings",
            href: `/organizations/${orgId}/settings`,
            icon: Settings,
          },
        ]
      : []),
  ];

  return (
    <nav className="flex flex-col gap-1 px-3">
      {items.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/organizations" && pathname.startsWith(`${item.href}/`));
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="truncate">{item.label}</span>
            {isActive && <ChevronRight className="ml-auto h-3 w-3 text-primary/70" />}
          </Link>
        );
      })}
    </nav>
  );
}

export function OrganizationWorkspaceShell({
  children,
  user,
  org,
  title = org?.name || "Team workspaces",
  description = "Encrypted collaboration spaces for teams, files, and access.",
}: OrganizationWorkspaceShellProps) {
  const initials = userInitials(user);

  const sidebar = (
    <>
      <div className="border-b border-sidebar-border px-6 py-5">
        <Link href="/organizations" className="flex items-center gap-2">
          <span className="font-brand text-xl italic text-sidebar-foreground">
            Xenode
          </span>
          <span className="rounded-full bg-sidebar-primary/10 px-2 py-0.5 text-xs font-medium text-sidebar-primary">
            Teams
          </span>
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto py-4">
        <NavItems orgId={org?.id} />
      </div>
      <div className="border-t border-sidebar-border p-4">
        <Link
          href="/dashboard"
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:text-sidebar-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Personal dashboard
        </Link>
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user.image || undefined} />
            <AvatarFallback className="bg-sidebar-primary/20 text-xs text-sidebar-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-sidebar-foreground">
              {user.name || "User"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {user.email}
            </p>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky left-0 top-0 hidden h-screen w-[260px] flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-xl">
          <div className="flex min-h-17 items-center gap-3 px-4 py-3 lg:px-8">
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground lg:hidden"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px] border-sidebar-border bg-sidebar p-0">
                <SheetTitle className="sr-only">Organization navigation</SheetTitle>
                <SheetDescription className="sr-only">
                  Team workspace navigation
                </SheetDescription>
                <div className="flex h-full flex-col">{sidebar}</div>
              </SheetContent>
            </Sheet>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold text-foreground">
                  {title}
                </h1>
                {org?.role && <Badge variant="outline">{org.role}</Badge>}
              </div>
              <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                {description}
              </p>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderOpen,
  BarChart3,
  Key,
  CreditCard,
  Settings,
  LogOut,
  ChevronRight,
  Menu,
  Share2,
  Users,
  CloudDownload,
  Image,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { SignOutDialog } from "@/components/dashboard/SignOutDialog";
import { useState, useEffect } from "react";

interface DashboardShellProps {
  children: React.ReactNode;
  user: {
    id: string;
    name: string;
    email: string;
    image?: string;
  };
}

const sidebarItems = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "My Files", href: "/dashboard/files", icon: FolderOpen },
  { label: "Photos", href: "/dashboard/photos", icon: Image },
  // { label: "Migrations", href: "/dashboard/migrations", icon: CloudDownload },
  { label: "Shared", href: "/dashboard/shared", icon: Share2 },
  { label: "Shared with me", href: "/dashboard/shared-with-me", icon: Users },
  { label: "Usage", href: "/dashboard/usage", icon: BarChart3 },
  // { label: "API Keys", href: "/dashboard/keys", icon: Key },
  { label: "Billing", href: "/dashboard/billing", icon: CreditCard },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

function SidebarNav({ pathname }: { pathname: string }) {
  return (
    <nav className="flex flex-col gap-1 px-3">
      {sidebarItems.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group ${
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
            }`}
          >
            <Icon
              className={`w-4 h-4 ${
                isActive
                  ? "text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 group-hover:text-sidebar-foreground"
              }`}
            />
            {item.label}
            {isActive && (
              <ChevronRight className="w-3 h-3 ml-auto text-primary/60" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function DashboardShell({ children, user }: DashboardShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user.email[0].toUpperCase();

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sign out dialog */}
      <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-[260px] border-r border-sidebar-border bg-sidebar sticky top-0 left-0 h-screen">
        {/* Logo */}
        <div className="px-6 py-5 border-b border-sidebar-border">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-xl font-brand italic text-sidebar-foreground">
              Xenode
            </span>
            <span className="text-xs font-medium text-sidebar-primary bg-sidebar-primary/10 px-2 py-0.5 rounded-full">
              Storage
            </span>
          </Link>
        </div>

        {/* Nav */}
        <div className="flex-1 py-4 overflow-y-auto">
          <SidebarNav pathname={pathname} />
        </div>

        {/* User section at bottom */}
        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3">
            <Avatar className="w-8 h-8">
              <AvatarImage src={user.image} />
              <AvatarFallback className="bg-sidebar-primary/20 text-sidebar-primary text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">
                {user.name}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {user.email}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
          <div className="flex items-center justify-between px-4 lg:px-8 h-17">
            {/* Mobile menu */}
            {mounted ? (
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="lg:hidden text-muted-foreground hover:text-foreground hover:bg-accent"
                  >
                    <Menu className="w-5 h-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="w-[280px] bg-sidebar border-sidebar-border p-0"
                >
                  <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                  <SheetDescription className="sr-only">
                    Main navigation menu
                  </SheetDescription>
                  <div className="px-6 py-5 border-b border-sidebar-border">
                    <span className="text-xl font-brand italic text-sidebar-foreground">
                      Xenode
                    </span>
                    <span className="ml-2 text-xs font-medium text-sidebar-primary bg-sidebar-primary/10 px-2 py-0.5 rounded-full">
                      Storage
                    </span>
                  </div>
                  <div className="py-4">
                    <SidebarNav pathname={pathname} />
                  </div>
                </SheetContent>
              </Sheet>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <Menu className="w-5 h-5" />
              </Button>
            )}

            {/* Breadcrumb area */}
            <div className="hidden lg:block" />

            {/* User dropdown */}
            <div className="ml-auto">
              {mounted ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="flex items-center gap-2 hover:bg-accent px-2"
                    >
                      <Avatar className="w-7 h-7">
                        <AvatarImage src={user.image} />
                        <AvatarFallback className="bg-primary/20 text-primary text-xs">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm text-foreground/80 hidden sm:inline">
                        {user.name}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-56 bg-card border-border text-foreground"
                  >
                    <div className="px-3 py-2">
                      <p className="text-sm font-medium">{user.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                    <DropdownMenuSeparator className="bg-border" />
                    <DropdownMenuItem asChild>
                      <Link
                        href="/dashboard/settings"
                        className="cursor-pointer hover:bg-accent text-foreground/80 focus:bg-accent focus:text-foreground"
                      >
                        <Settings className="w-4 h-4 mr-2" />
                        Account Settings
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-border" />
                    <DropdownMenuItem
                      onClick={() => setSignOutOpen(true)}
                      className="cursor-pointer text-destructive hover:bg-destructive/10 focus:bg-destructive/10 focus:text-destructive"
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      Sign Out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button
                  variant="ghost"
                  className="flex items-center gap-2 hover:bg-accent px-2"
                >
                  <Avatar className="w-7 h-7">
                    <AvatarImage src={user.image} />
                    <AvatarFallback className="bg-primary/20 text-primary text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm text-foreground/80 hidden sm:inline">
                    {user.name}
                  </span>
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/auth/client";
import { useRouter } from "next/navigation";
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
import { useState } from "react";

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
  { label: "Usage", href: "/dashboard/usage", icon: BarChart3 },
  { label: "API Keys", href: "/dashboard/keys", icon: Key },
  { label: "Billing", href: "/dashboard/billing", icon: CreditCard },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

function SidebarNav({ pathname }: { pathname: string }) {
  return (
    <nav className="flex flex-col gap-1 px-3">
      {sidebarItems.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(item.href));
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group ${
              isActive
                ? "bg-[#7cb686]/15 text-[#7cb686]"
                : "text-[#e8e4d9]/60 hover:text-[#e8e4d9] hover:bg-white/5"
            }`}
          >
            <Icon
              className={`w-4 h-4 ${
                isActive
                  ? "text-[#7cb686]"
                  : "text-[#e8e4d9]/40 group-hover:text-[#e8e4d9]/60"
              }`}
            />
            {item.label}
            {isActive && (
              <ChevronRight className="w-3 h-3 ml-auto text-[#7cb686]/60" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function DashboardShell({ children, user }: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user.email[0].toUpperCase();

  return (
    <div className="min-h-screen flex bg-[#0f1a12]">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-[260px] border-r border-white/5 bg-[#121e15]">
        {/* Logo */}
        <div className="px-6 py-5 border-b border-white/5">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-xl font-brand italic text-[#e8e4d9]">
              Xenode
            </span>
            <span className="text-xs font-medium text-[#7cb686] bg-[#7cb686]/10 px-2 py-0.5 rounded-full">
              Storage
            </span>
          </Link>
        </div>

        {/* Nav */}
        <div className="flex-1 py-4 overflow-y-auto">
          <SidebarNav pathname={pathname} />
        </div>

        {/* User section at bottom */}
        <div className="border-t border-white/5 p-4">
          <div className="flex items-center gap-3">
            <Avatar className="w-8 h-8">
              <AvatarImage src={user.image} />
              <AvatarFallback className="bg-[#7cb686]/20 text-[#7cb686] text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#e8e4d9] truncate">
                {user.name}
              </p>
              <p className="text-xs text-[#e8e4d9]/40 truncate">{user.email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-40 border-b border-white/5 bg-[#0f1a12]/80 backdrop-blur-xl">
          <div className="flex items-center justify-between px-4 lg:px-8 h-14">
            {/* Mobile menu */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden text-[#e8e4d9]/60 hover:text-[#e8e4d9] hover:bg-white/5"
                >
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-[280px] bg-[#121e15] border-white/5 p-0"
              >
                <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                <SheetDescription className="sr-only">
                  Main navigation menu
                </SheetDescription>
                <div className="px-6 py-5 border-b border-white/5">
                  <span className="text-xl font-brand italic text-[#e8e4d9]">
                    Xenode
                  </span>
                  <span className="ml-2 text-xs font-medium text-[#7cb686] bg-[#7cb686]/10 px-2 py-0.5 rounded-full">
                    Storage
                  </span>
                </div>
                <div className="py-4">
                  <SidebarNav pathname={pathname} />
                </div>
              </SheetContent>
            </Sheet>

            {/* Breadcrumb area */}
            <div className="hidden lg:block" />

            {/* User dropdown */}
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="flex items-center gap-2 hover:bg-white/5 px-2"
                  >
                    <Avatar className="w-7 h-7">
                      <AvatarImage src={user.image} />
                      <AvatarFallback className="bg-[#7cb686]/20 text-[#7cb686] text-xs">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-[#e8e4d9]/80 hidden sm:inline">
                      {user.name}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-56 bg-[#1a2e1d] border-white/10 text-[#e8e4d9]"
                >
                  <div className="px-3 py-2">
                    <p className="text-sm font-medium">{user.name}</p>
                    <p className="text-xs text-[#e8e4d9]/50">{user.email}</p>
                  </div>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem asChild>
                    <Link
                      href="/dashboard/settings"
                      className="cursor-pointer hover:bg-white/5 text-[#e8e4d9]/80 focus:bg-white/5 focus:text-[#e8e4d9]"
                    >
                      <Settings className="w-4 h-4 mr-2" />
                      Account Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem
                    onClick={handleSignOut}
                    className="cursor-pointer text-red-400 hover:bg-red-400/10 focus:bg-red-400/10 focus:text-red-400"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Layers,
  DollarSign,
  Ticket,
  Activity,
  FileText,
} from "lucide-react";

interface AdminSidebarProps {
  role: "super_admin" | "admin";
  username: string;
}

const navItems = [
  {
    href: "/admin/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ["super_admin", "admin"],
  },
  {
    href: "/admin/dashboard/users",
    label: "Users",
    icon: Users,
    roles: ["super_admin", "admin"],
  },
  {
    href: "/admin/dashboard/admins",
    label: "Admins",
    icon: ShieldCheck,
    roles: ["super_admin"],
  },
  {
    href: "/admin/dashboard/logs",
    label: "Logs",
    icon: ShieldCheck,
    roles: ["super_admin"],
  },
  {
    href: "/admin/dashboard/storage",
    label: "Storage",
    icon: ShieldCheck,
    roles: ["super_admin"],
  },
  {
    href: "/admin/dashboard/pricing",
    label: "Pricing",
    icon: DollarSign,
    roles: ["super_admin"],
  },
  {
    href: "/admin/dashboard/coupons",
    label: "Coupons",
    icon: Ticket,
    roles: ["super_admin"],
  },
  {
    href: "/admin/dashboard/simulator",
    label: "Billing Simulator",
    icon: Activity,
    roles: ["super_admin"],
  },
  {
    href: "/admin/dashboard/blogs",
    label: "Blogs",
    icon: FileText,
    roles: ["super_admin", "admin"],
  },
];

export function AdminSidebar({ role, username }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const visibleItems = navItems.filter((item) => item.roles.includes(role));

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
  }

  return (
    <aside
      className={`flex flex-col bg-zinc-900 border-r border-zinc-800 transition-all duration-300 ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      <div className="flex items-center justify-between px-4 py-4 border-b border-zinc-800">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center">
              <Layers className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-white">Xenode Admin</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="p-1 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      <nav className="flex-1 py-4 space-y-1 px-2">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-800"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-zinc-800 px-2 py-3">
        {!collapsed && (
          <div className="px-3 py-1.5 mb-1">
            <p className="text-xs text-zinc-500 truncate">{username}</p>
            <p className="text-xs text-zinc-600">{role === "super_admin" ? "Super Admin" : "Admin"}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>{loggingOut ? "Logging out…" : "Logout"}</span>}
        </button>
      </div>
    </aside>
  );
}

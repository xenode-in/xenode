"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/SignOutButton";

const links = [
  ["Overview", "/"],
  ["Profile", "/profile"],
  ["Connections", "/linked-accounts"],
  ["Security", "/security"],
  ["Organizations", "/organizations"],
  ["Usage", "/usage"],
] as const;

export function AccountShell({
  user,
  children,
}: {
  user: { name: string; email: string };
  children: ReactNode;
}) {
  const pathname = usePathname();
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();

  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">X</span>
          <span className="brand-wordmark">Xenode Account</span>
        </Link>
        <nav className="nav" aria-label="Account navigation">
          {links.map(([label, href]) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="topbar-account">
          <div className="account-chip" title={user.email}>
            <span className="avatar">{initial}</span>
            <span>{user.name || user.email}</span>
          </div>
          <SignOutButton className="button button-secondary button-sm" />
        </div>
      </header>
      {children}
    </div>
  );
}

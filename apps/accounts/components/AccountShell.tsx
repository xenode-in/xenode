import type { ReactNode } from "react";
import Link from "next/link";

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
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();
  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" href="/"><span>X</span> Xenode Account</Link>
        <nav className="nav" aria-label="Account navigation">
          {links.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
        <div className="account-chip" title={user.email}>
          <span className="avatar">{initial}</span>
          <span>{user.name || user.email}</span>
        </div>
      </header>
      {children}
    </div>
  );
}

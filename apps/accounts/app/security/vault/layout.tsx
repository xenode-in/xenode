import type { ReactNode } from "react";
import { requireUnlockedAccountsPageSession } from "@/lib/session";

export default async function VaultSecurityLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireUnlockedAccountsPageSession("/security/vault");
  return children;
}

import { CryptoProvider } from "@/contexts/CryptoContext";
import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Organizations" };

export default async function OrganizationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageSession();

  return (
    <CryptoProvider
      initialUserId={session.user.id}
      initialSessionId={session.session.id}
    >
      {children}
    </CryptoProvider>
  );
}

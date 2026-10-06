import { CryptoProvider } from "@/contexts/CryptoContext";
import { requirePageSession } from "@/lib/auth/session";

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

import { redirect } from "next/navigation";
import { CryptoProvider } from "@/contexts/CryptoContext";
import { getServerSession } from "@/lib/auth/session";

export default async function OrganizationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <CryptoProvider initialUserId={session.user.id}>{children}</CryptoProvider>
  );
}

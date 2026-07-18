import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { CryptoProvider } from "@/contexts/CryptoContext";

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();

  if (!session) {
    redirect("/auth/login");
  }

  // If they are already onboarded, don't let them back in
  if (session.user.onboarded) {
    redirect("/dashboard");
  }

  return (
    <CryptoProvider initialUserId={session.user.id}>
      <div className="min-h-screen bg-background">{children}</div>
    </CryptoProvider>
  );
}

import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { CryptoProvider } from "@/contexts/CryptoContext";
import { CryptoDashboardWrapper } from "@/components/dashboard/CryptoDashboardWrapper";

export const metadata: Metadata = {
  title: "Editor",
  description: "Edit your end-to-end encrypted documents",
  robots: { index: false, follow: false },
};

/**
 * Full-screen editor shell layout. Unlike the dashboard it has no sidebar — the
 * editor owns the whole viewport. It still requires an authenticated, verified,
 * onboarded session and mounts the CryptoProvider so the editor can unwrap the
 * vault key client-side. CryptoDashboardWrapper supplies the unlock/setup modal.
 */
export default async function EditorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();

  if (!session) {
    redirect("/login");
  }
  if (session.user.emailVerified === false) {
    redirect("/verify-email");
  }
  if ((session.user as { onboarded?: boolean }).onboarded === false) {
    redirect("/onboarding");
  }

  return (
    <CryptoProvider>
      <CryptoDashboardWrapper>
        <div className="h-dvh w-full overflow-hidden bg-background">{children}</div>
      </CryptoDashboardWrapper>
    </CryptoProvider>
  );
}

import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { UploadProvider } from "@/contexts/UploadContext";
import { UploadProgress } from "@/components/upload/UploadProgress";
import { CryptoProvider } from "@/contexts/CryptoContext";
import { CryptoDashboardWrapper } from "@/components/dashboard/CryptoDashboardWrapper";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Manage your Xenode Storage buckets and files",
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <CryptoProvider>
      <UploadProvider>
        <DashboardShell
          user={{
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            image: session.user.image || undefined,
          }}
        >
          <CryptoDashboardWrapper>{children}</CryptoDashboardWrapper>
        </DashboardShell>
        <UploadProgress />
      </UploadProvider>
    </CryptoProvider>
  );
}

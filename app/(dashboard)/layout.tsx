import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { UploadProvider } from "@/contexts/UploadContext";
import { UploadProgress } from "@/components/upload/UploadProgress";
import { CryptoProvider } from "@/contexts/CryptoContext";
import { PreviewProvider } from "@/contexts/PreviewContext";
import { DownloadProvider } from "@/contexts/DownloadContext";
import { CryptoDashboardWrapper } from "@/components/dashboard/CryptoDashboardWrapper";
import { DownloadProgress } from "@/components/dashboard/DownloadProgress";
// import UploadDebugOverlay from "@/components/debug/UploadDebugOverlay"; // TODO: Remove after iOS debugging

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Manage your Xenode files",
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

  // Enforce email verification
  if (session.user.emailVerified === false) {
    redirect("/verify-email");
  }

  // Redirect to onboarding if not completed
  // Use loose check in case the field is undefined for older users
  if ((session.user as any).onboarded === false) {
    redirect("/onboarding");
  }

  return (
    <CryptoProvider initialUserId={session.user.id}>
      <DownloadProvider>
        <PreviewProvider>
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
            <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-4 w-96 max-w-[calc(100vw-2rem)] pointer-events-none *:pointer-events-auto">
              <UploadProgress />
              <DownloadProgress />
            </div>
            {/* <UploadDebugOverlay /> TODO: Remove after iOS debugging */}
          </UploadProvider>
        </PreviewProvider>
      </DownloadProvider>
    </CryptoProvider>
  );
}

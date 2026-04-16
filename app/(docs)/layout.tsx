import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { UploadProvider } from "@/contexts/UploadContext";
import { UploadProgress } from "@/components/upload/UploadProgress";
import { CryptoProvider } from "@/contexts/CryptoContext";
import { PreviewProvider } from "@/contexts/PreviewContext";
import { DownloadProvider } from "@/contexts/DownloadContext";
import { CryptoDashboardWrapper } from "@/components/dashboard/CryptoDashboardWrapper";
import { DownloadProgress } from "@/components/dashboard/DownloadProgress";

export default async function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();

  if (!session) {
    const mainUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    redirect(`${mainUrl}/login`);
  }

  return (
    <CryptoProvider>
      <DownloadProvider>
        <PreviewProvider>
          <UploadProvider>
            <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
              <CryptoDashboardWrapper>{children}</CryptoDashboardWrapper>
            </div>
            <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-4 w-96 max-w-[calc(100vw-2rem)] pointer-events-none *:pointer-events-auto">
              <UploadProgress />
              <DownloadProgress />
            </div>
          </UploadProvider>
        </PreviewProvider>
      </DownloadProvider>
    </CryptoProvider>
  );
}

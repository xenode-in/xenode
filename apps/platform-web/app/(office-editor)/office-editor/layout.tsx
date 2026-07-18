import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { CryptoProvider } from "@/contexts/CryptoContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { UploadProvider } from "@/contexts/UploadContext";
import { CryptoDashboardWrapper } from "@/components/dashboard/CryptoDashboardWrapper";
import { UploadProgress } from "@/components/upload/UploadProgress";

export default async function OfficeEditorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  if (!session) redirect(`/auth/login?next=${encodeURIComponent("/office-editor")}`);

  return (
    <CryptoProvider initialUserId={session.user.id}>
      <WorkspaceProvider workspace={{ kind: "personal" }}>
        <UploadProvider>
          <div className="h-screen w-full overflow-hidden bg-background">
            <CryptoDashboardWrapper>{children}</CryptoDashboardWrapper>
          </div>
          <div className="pointer-events-none fixed bottom-4 right-4 z-50 w-96 max-w-[calc(100vw-2rem)] *:pointer-events-auto">
            <UploadProgress />
          </div>
        </UploadProvider>
      </WorkspaceProvider>
    </CryptoProvider>
  );
}

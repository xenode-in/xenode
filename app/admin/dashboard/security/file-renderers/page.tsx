import { redirect } from "next/navigation";
import { FileRendererControls } from "@/components/admin/FileRendererControls";
import { getAdminSession } from "@/lib/admin/session";

export const dynamic = "force-dynamic";

export default async function FileRenderersPage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (session.role !== "super_admin") redirect("/admin/dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">File renderer security</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fail-closed operational controls for every decrypted renderer.
        </p>
      </div>
      <FileRendererControls />
    </div>
  );
}

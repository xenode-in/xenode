import { AdminsManager } from "@/components/admin/AdminsManager";
import { getAdminSession } from "@/lib/admin/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminsPage() {
  const session = await getAdminSession();

  // Only super_admin can access this page
  if (!session || session.role !== "super_admin") {
    redirect("/admin/dashboard");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Admin Management</h1>
        <p className="text-zinc-400 text-sm mt-1">Create and manage admin accounts</p>
      </div>
      <AdminsManager />
    </div>
  );
}

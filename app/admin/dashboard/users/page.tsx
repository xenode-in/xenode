import { AdminUsersTable } from "@/components/admin/AdminUsersTable";

export const dynamic = "force-dynamic";

export default function AdminUsersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Users</h1>
        <p className="text-zinc-400 text-sm mt-1">All registered users and their storage usage</p>
      </div>
      <AdminUsersTable />
    </div>
  );
}

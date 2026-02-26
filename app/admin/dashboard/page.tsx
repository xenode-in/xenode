import { AdminStatsCards } from "@/components/admin/AdminStatsCards";
import { AdminStorageChart } from "@/components/admin/AdminStorageChart";

export const dynamic = "force-dynamic";

export default function AdminDashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <p className="text-zinc-400 text-sm mt-1">Platform overview and key metrics</p>
      </div>
      <AdminStatsCards />
      <AdminStorageChart />
    </div>
  );
}

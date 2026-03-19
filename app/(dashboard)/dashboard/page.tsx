import { requireAuth } from "@/lib/auth/session";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

export default async function DashboardPage() {
  await requireAuth();

  return (
    <DashboardClient />
  );
}

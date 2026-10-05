import { getStorageUsageReconciliation } from "@xenode/database";
import { getAdminSession } from "@/lib/admin/session";

export async function GET(request: Request) {
  if (!await getAdminSession()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId || orgId.length > 128 || !/^[a-zA-Z0-9_-]+$/u.test(orgId)) {
    return Response.json({ error: "A valid orgId is required" }, { status: 400 });
  }
  try {
    const report = await getStorageUsageReconciliation({ type: "organization", id: orgId });
    return Response.json(report, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Usage reconciliation is unavailable" }, { status: 503 });
  }
}

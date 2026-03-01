import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import { getApiLogModel } from "@/models/ApiLog";

export const dynamic = "force-dynamic";

/** GET /api/admin/logs — paginated API log viewer with filters */
export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("limit") ?? "50"))
  );
  const skip = (page - 1) * limit;

  const query: Record<string, unknown> = {};

  const userId = searchParams.get("userId");
  if (userId) query.userId = userId;

  const endpoint = searchParams.get("endpoint");
  if (endpoint) query.endpoint = { $regex: endpoint, $options: "i" };

  const statusCode = searchParams.get("statusCode");
  if (statusCode) query.statusCode = Number(statusCode);

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (from || to) {
    query.createdAt = {
      ...(from ? { $gte: new Date(from) } : {}),
      ...(to ? { $lte: new Date(to) } : {}),
    };
  }

  const ApiLog = await getApiLogModel();
  const [logs, total] = await Promise.all([
    ApiLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ApiLog.countDocuments(query),
  ]);

  return NextResponse.json({
    logs,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

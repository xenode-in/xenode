import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import { getApiLogModel } from "@/models/ApiLog";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/logs
 * Paginated API log viewer with optional filters.
 * Query params: page, limit, userId, endpoint, statusCode, from, to
 */
export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50")));
  const skip = (page - 1) * limit;

  const userId = searchParams.get("userId") ?? "";
  const endpoint = searchParams.get("endpoint") ?? "";
  const statusCode = searchParams.get("statusCode") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  const query: Record<string, unknown> = {};
  if (userId) query.userId = userId;
  if (endpoint) query.endpoint = { $regex: endpoint, $options: "i" };
  if (statusCode) query.statusCode = Number(statusCode);
  if (from || to) {
    query.createdAt = {
      ...(from ? { $gte: new Date(from) } : {}),
      ...(to ? { $lte: new Date(to) } : {}),
    };
  }

  const ApiLog = await getApiLogModel();
  const [logs, total] = await Promise.all([
    ApiLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ApiLog.countDocuments(query),
  ]);

  return NextResponse.json({
    logs,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

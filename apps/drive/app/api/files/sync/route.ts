import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import { readDriveSyncPage, DriveSyncError } from "@xenode/database";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    const query = request.nextUrl.searchParams;
    if (query.has("lastSync")) return NextResponse.json({ error: "Timestamp sync is no longer supported" }, { status: 400 });
    const page = await readDriveSyncPage({ accountId: ctx.accountId, spaceId: ctx.spaceId,
      cursor: query.get("cursor"), limit: Number(query.get("limit") ?? 500) });
    return NextResponse.json(page, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    if (error instanceof DriveSyncError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "Could not read sync state" }, { status: 503 });
  }
}

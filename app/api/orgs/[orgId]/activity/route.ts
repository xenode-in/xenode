import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { assertOrgMemberRole } from "@/lib/orgs/access";
import ActivityLog, { type IActivityLog } from "@/models/ActivityLog";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;

function serialize(row: IActivityLog) {
  return {
    id: row._id.toString(),
    action: row.action,
    actorUserId: row.actorUserId,
    actorType: row.actorType,
    target: row.target ?? null,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt,
  };
}

/**
 * GET /api/orgs/[orgId]/activity — paginated org activity feed.
 *
 * Non-guest members only (guests can't see org internals). Cursor pagination
 * on the monotonic `_id` (ObjectId embeds time), newest first. Optional
 * `?action=` filter and `?limit=`.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin", "manager", "member"],
    });

    await dbConnect();
    const url = request.nextUrl;
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT),
    );
    const action = url.searchParams.get("action");
    const cursor = url.searchParams.get("cursor");

    const filter: Record<string, unknown> = { orgId };
    if (action) filter.action = action;
    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    // Fetch one extra to detect whether another page exists.
    const rows = await ActivityLog.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean<IActivityLog[]>();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1]._id.toString() : null;

    return NextResponse.json({
      items: page.map(serialize),
      nextCursor,
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to load activity";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

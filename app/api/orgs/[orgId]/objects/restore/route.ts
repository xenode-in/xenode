import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { orgObjectClause, requireOrgStorageMembership } from "@/lib/orgs/storage";
import StorageObject from "@/models/StorageObject";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

const MAX_IDS = 5000;

/**
 * POST /api/orgs/[orgId]/objects/restore — pull binned org objects back out of
 * the Bin (unset `deletedAt`). Pure flag flip: the blobs were never removed on
 * soft-delete, so there's no B2 work and no metering change. Any writing member
 * may restore. Folder children and sidecars are restored alongside.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await requireOrgStorageMembership({ userId: ctx.userId, orgId, action: "write" });

    const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
    if (!Array.isArray(body.ids)) {
      return NextResponse.json({ error: "ids must be an array" }, { status: 400 });
    }
    const ids = Array.from(
      new Set(body.ids.filter((x): x is string => typeof x === "string" && !!x)),
    ).slice(0, MAX_IDS);
    if (ids.length === 0) {
      return NextResponse.json({ success: true, restoredCount: 0 });
    }

    await dbConnect();

    const objects = await StorageObject.find({
      _id: { $in: ids },
      ...orgObjectClause(orgId),
      deletedAt: { $exists: true },
    })
      .select("_id key contentType")
      .lean<{ _id: Types.ObjectId; key?: string; contentType?: string }[]>();

    if (objects.length === 0) {
      return NextResponse.json({ success: true, restoredCount: 0 });
    }

    let allDocIds = objects.map((o) => o._id);

    // Restore folder children too.
    const folderPrefixes = objects
      .filter(
        (o) =>
          o.key &&
          (o.contentType === "application/x-directory" || o.key.endsWith("/")),
      )
      .map((o) => o.key as string);
    if (folderPrefixes.length > 0) {
      const children = await StorageObject.find({
        ...orgObjectClause(orgId),
        deletedAt: { $exists: true },
        $or: folderPrefixes.map((prefix) => ({
          key: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` },
        })),
      })
        .select("_id")
        .lean<{ _id: Types.ObjectId }[]>();
      allDocIds = allDocIds.concat(children.map((c) => c._id));
    }

    // Restore sidecars alongside their parents.
    const sidecars = await StorageObject.find({
      parentObjectId: { $in: allDocIds },
      ...orgObjectClause(orgId),
      deletedAt: { $exists: true },
    })
      .select("_id")
      .lean<{ _id: Types.ObjectId }[]>();
    allDocIds = Array.from(
      new Set([...allDocIds, ...sidecars.map((s) => s._id)].map(String)),
    ).map((id) => new Types.ObjectId(id));

    await StorageObject.updateMany(
      { _id: { $in: allDocIds } },
      { $unset: { deletedAt: "" } },
    );

    return NextResponse.json({ success: true, restoredCount: objects.length });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to restore objects";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

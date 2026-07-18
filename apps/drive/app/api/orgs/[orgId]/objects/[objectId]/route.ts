import { NextRequest, NextResponse } from "next/server";
import { AuthzError, isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { orgObjectClause, requireOrgStorageMembership } from "@/lib/orgs/storage";
import StorageObject from "@/models/StorageObject";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string; objectId: string }>;
}

/**
 * PATCH /api/orgs/[orgId]/objects/[objectId] — mutate lightweight, non-crypto
 * flags on an org object. Currently supports `starred` (Favorites). Any writing
 * member may star. Never touches keys/DEK/name.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId, objectId } = await params;
    await requireOrgStorageMembership({ userId: ctx.userId, orgId, action: "write" });

    const body = (await request.json().catch(() => ({}))) as { starred?: unknown };
    if (typeof body.starred !== "boolean") {
      return NextResponse.json({ error: "starred (boolean) is required" }, { status: 400 });
    }

    await dbConnect();
    const updated = await StorageObject.findOneAndUpdate(
      { _id: objectId, ...orgObjectClause(orgId) },
      { $set: { starred: body.starred } },
      { new: true },
    ).lean();
    if (!updated) {
      throw new AuthzError(404, "object_not_found", "Object not found");
    }

    return NextResponse.json({ id: objectId, starred: body.starred });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to update object";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

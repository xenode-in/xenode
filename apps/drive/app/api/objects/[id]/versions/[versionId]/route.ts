import { NextRequest, NextResponse } from "next/server";
import { queueDriveVersionDeletion } from "@xenode/database";
import { requireAccessContext, assertObjectAccess, isAuthzError, toJsonResponse } from "@/lib/authz";
import { revisionError } from "@/lib/storage/revision-upload";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const ctx = await requireAccessContext(request);
    const { id, versionId } = await params;
    const object = await assertObjectAccess(ctx, id, "delete");
    await queueDriveVersionDeletion({ objectId: object._id, spaceId: ctx.spaceId, versionId });
    return NextResponse.json({ success: true, pendingDeletion: true }, { status: 202 });
  } catch (error) { return isAuthzError(error) ? toJsonResponse(error) : revisionError(error); }
}

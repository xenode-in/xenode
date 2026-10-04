import { NextRequest, NextResponse } from "next/server";
import { restoreDriveVersion } from "@xenode/database";
import { requireAccessContext, assertObjectAccess, isAuthzError, toJsonResponse } from "@/lib/authz";
import { REVISION_HEADER, parseBaseRevision } from "@/lib/storage/revisions";
import { revisionError } from "@/lib/storage/revision-upload";
import StorageObject from "@/models/StorageObject";
import { publishSyncEvent, toSyncObjectSnapshot } from "@/lib/realtime/publish";
import { folderListingId } from "@/lib/storage/folders";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const ctx = await requireAccessContext(request);
    const { id, versionId } = await params;
    const baseRevision = parseBaseRevision(request.headers.get(REVISION_HEADER));
    if (baseRevision === null || Number.isNaN(baseRevision)) {
      return NextResponse.json({ error: "Base revision is required", code: "base_revision_required" }, { status: 400 });
    }
    const object = await assertObjectAccess(ctx, id, "write");
    const result = await restoreDriveVersion({ objectId: object._id, spaceId: ctx.spaceId, versionId, accountId: ctx.accountId, baseRevision });
    await StorageObject.findOne({ _id: object._id, spaceId: ctx.spaceId }).then(async (current) => {
      if (!current) return;
      await publishSyncEvent({
        userId: ctx.accountId, spaceId: ctx.spaceId, type: "FILE_UPDATED",
        payload: { objectId: String(current._id), bucketId: String(current.bucketId), folderIds: [folderListingId(current.folderId)], object: toSyncObjectSnapshot(current) },
        invalidateFolders: [current.folderId ?? null], invalidateStorage: true, invalidateRecent: true,
      });
    }).catch((error) => console.error("Version restore notification failed:", error));
    return NextResponse.json({ success: true, revision: result.revision });
  } catch (error) { return isAuthzError(error) ? toJsonResponse(error) : revisionError(error); }
}

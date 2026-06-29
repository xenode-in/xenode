import { NextRequest, NextResponse } from "next/server";
import {
  requireAccessContext,
  assertObjectAccess,
  isAuthzError,
  toJsonResponse,
} from "@/lib/authz";
import {
  snapshotCurrentAsVersion,
  evictOverflow,
} from "@/lib/storage/versions";
import {
  parentPrefixForKey,
  publishSyncEvent,
  toSyncObjectSnapshot,
} from "@/lib/realtime/publish";

export const dynamic = "force-dynamic";

/**
 * POST /api/objects/[id]/versions/[versionId]/restore
 * Promote a historical version to be the current content. The restore is itself
 * reversible: the previous current content is snapshotted back into the version
 * list. No bytes move in B2 (only which blob is "current" changes), so storage
 * metering is unaffected.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const ctx = await requireAccessContext(request);
    const { id, versionId } = await params;

    const object = await assertObjectAccess(ctx, id, "write");

    const versions = object.versions || [];
    const target = versions.find((v) => v.versionId === versionId);
    if (!target) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Snapshot the current content so the restore can be undone.
    const currentSnapshot = snapshotCurrentAsVersion(object, ctx.userId);

    // Point current content at the chosen version.
    object.key = target.key;
    object.b2FileId = target.b2FileId;
    object.size = target.size;
    if (target.contentType) object.contentType = target.contentType;
    object.encryptedDEK = target.encryptedDEK;
    object.iv = target.iv;
    object.chunkSize = target.chunkSize;
    object.chunkCount = target.chunkCount;
    object.chunkIvs = target.chunkIvs;
    object.chunks = target.chunks;
    object.encryptedMetadata = target.encryptedMetadata;
    object.updatedAt = new Date();

    // Rebuild history: old-current becomes newest version; remove the restored
    // entry. Count is unchanged, so eviction is a no-op here (kept for safety).
    const rebuilt = [
      currentSnapshot,
      ...versions.filter((v) => v.versionId !== versionId),
    ];
    object.versions = evictOverflow(rebuilt).kept;

    await object.save();

    await publishSyncEvent({
      userId: ctx.userId,
      type: "FILE_UPDATED",
      payload: {
        bucketId: object.bucketId.toString(),
        objectId: object._id.toString(),
        key: object.key,
        parentPrefix: parentPrefixForKey(object.key),
        object: toSyncObjectSnapshot(object),
      },
      invalidatePrefixes: [parentPrefixForKey(object.key)],
      invalidateRecent: true,
    });

    return NextResponse.json({ success: true, object });
  } catch (error: unknown) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

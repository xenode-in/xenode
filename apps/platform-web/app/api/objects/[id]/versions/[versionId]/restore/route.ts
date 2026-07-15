import { NextRequest, NextResponse } from "next/server";
import {
  requireAccessContext,
  assertObjectAccess,
  bucketOwnershipClause,
  isAuthzError,
  toJsonResponse,
} from "@/lib/authz";
import {
  snapshotCurrentAsVersion,
  evictOverflow,
  collectVersionB2Keys,
  versionsTotalBytes,
} from "@/lib/storage/versions";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import { deleteObjects } from "@/lib/b2/objects";
import { adjustStorageBytes, updateBucketStats } from "@/lib/metering/usage";
import { adjustOrgStorage } from "@/lib/orgs/billing/orgUsage";
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

    // Snapshot the current content so the restore can be undone, unless it is
    // already represented by the pinned original entry.
    const original = versions.find((version) => version.isOriginal);
    const currentIsPinnedOriginal = original?.key === object.key;
    const currentSnapshot = currentIsPinnedOriginal
      ? null
      : snapshotCurrentAsVersion(object, ctx.userId);

    // Point current content at the chosen version.
    object.key = target.key;
    object.b2FileId = target.b2FileId;
    object.size = target.size;
    if (target.contentType) object.contentType = target.contentType;
    object.encryptedDEK = target.encryptedDEK;
    object.wrappedBy = target.wrappedBy;
    object.spaceKeyId = target.spaceKeyId;
    object.spaceKeyVersion = target.spaceKeyVersion;
    object.spaceKeyWrapIv = target.spaceKeyWrapIv;
    object.iv = target.iv;
    object.chunkSize = target.chunkSize;
    object.chunkCount = target.chunkCount;
    object.chunkIvs = target.chunkIvs;
    object.chunks = target.chunks;
    object.encryptedMetadata = target.encryptedMetadata;
    object.updatedAt = new Date();
    object.revision = (object.revision ?? 0) + 1;

    // Keep the immutable original even when it becomes current. Other restored
    // entries are promoted out of history as before.
    if (original) original.sharesCurrentContent = original.key === target.key;
    const remaining = target.isOriginal
      ? versions
      : versions.filter((version) => version.versionId !== versionId);
    const rebuilt = currentSnapshot
      ? [currentSnapshot, ...remaining]
      : remaining;
    const { kept, evicted } = evictOverflow(rebuilt);
    object.versions = kept;

    await object.save();

    if (evicted.length > 0) {
      await dbConnect();
      const bucket = await Bucket.findOne({
        _id: object.bucketId,
        ...bucketOwnershipClause(ctx),
      })
        .select("b2BucketId")
        .lean<{ b2BucketId: string }>();
      if (bucket) {
        const protectedKeys = new Set([
          object.key,
          ...(object.chunks ?? []).map((chunk) => chunk.key),
          ...kept.flatMap(collectVersionB2Keys),
        ]);
        const keysToDelete = evicted
          .flatMap(collectVersionB2Keys)
          .filter((key) => !protectedKeys.has(key));
        await deleteObjects(bucket.b2BucketId, keysToDelete);
        const freedBytes = versionsTotalBytes(evicted);
        if (freedBytes > 0) {
          if (ctx.spaceType === "personal") {
            await adjustStorageBytes(ctx.userId, -freedBytes);
          } else {
            await adjustOrgStorage(ctx.organizationId!, -freedBytes);
          }
          await updateBucketStats(object.bucketId.toString(), 0, -freedBytes);
        }
      }
    }

    await publishSyncEvent({
      userId: ctx.userId,
      spaceId: ctx.spaceId,
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

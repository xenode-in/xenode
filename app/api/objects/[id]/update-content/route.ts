import { NextRequest, NextResponse } from "next/server";
import {
  requireAccessContext,
  objectFilter,
  bucketOwnershipClause,
  isAuthzError,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import StorageObject from "@/models/StorageObject";
import Bucket from "@/models/Bucket";
import { getUploadUrl, uploadObject, deleteObjects } from "@/lib/b2/objects";
import { updateBucketStats, adjustStorageBytes } from "@/lib/metering/usage";
import {
  snapshotCurrentAsVersion,
  newObjectKey,
  evictOverflow,
  collectVersionB2Keys,
  versionsTotalBytes,
} from "@/lib/storage/versions";

export const dynamic = "force-dynamic";

/**
 * POST /api/objects/[id]/update-content
 * Overwrites an existing object's content, KEEPING the previous content as a
 * version (newest-first, capped at MAX_VERSIONS_PER_OBJECT).
 *
 * The new content is written to a *fresh* B2 key so the prior bytes are never
 * clobbered — no server-side ciphertext copy is needed, which keeps the E2EE
 * boundary intact. The previous current-content snapshot is prepended to
 * `versions[]`; overflow versions are evicted (B2 blob deleted + quota freed).
 *
 * For direct server uploads, send application/octet-stream with ?iv=<base64>
 * (and optionally ?dek=<base64> if the client rotated the wrapped DEK). JSON
 * requests are the older presigned-url flow and are NOT versioned (deprecated).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAccessContext(request);
    const userId = ctx.userId;
    const { id } = await params;
    const contentType = request.headers.get("content-type") || "";
    const isJsonRequest = contentType.includes("application/json");
    const body = isJsonRequest ? await request.json() : null;
    const iv = isJsonRequest
      ? body?.iv
      : request.nextUrl.searchParams.get("iv");
    const dek = isJsonRequest
      ? body?.encryptedDEK
      : request.nextUrl.searchParams.get("dek");

    if (!iv) {
      return NextResponse.json({ error: "IV is required" }, { status: 400 });
    }

    await dbConnect();

    const object = await StorageObject.findOne(objectFilter(ctx, id));
    if (!object) {
      return NextResponse.json({ error: "Object not found" }, { status: 404 });
    }

    const bucket = await Bucket.findOne({
      _id: object.bucketId,
      ...bucketOwnershipClause(ctx),
    });
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    if (!isJsonRequest) {
      const arrayBuffer = await request.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.byteLength === 0) {
        return NextResponse.json(
          { error: "File content is required" },
          { status: 400 },
        );
      }

      // 1. Snapshot the current content as a version (before mutating fields).
      const snapshot = snapshotCurrentAsVersion(object, userId);
      const { kept, evicted } = evictOverflow([
        snapshot,
        ...(object.versions || []),
      ]);
      const evictedBytes = versionsTotalBytes(evicted);
      const newSize = buffer.byteLength;

      // 2. Reserve quota FIRST (atomic + enforced). The retained old version now
      //    also occupies space, so the net delta is +newSize − evictedBytes.
      const netDelta = newSize - evictedBytes;
      if (netDelta !== 0) {
        await adjustStorageBytes(userId, netDelta); // throws QUOTA_EXCEEDED
      }

      // 3. Upload NEW content to a fresh key. Roll back the reservation on fail.
      const newKey = newObjectKey(userId);
      let uploadResult;
      try {
        uploadResult = await uploadObject(
          bucket.b2BucketId,
          newKey,
          buffer,
          "application/octet-stream",
          newSize,
        );
      } catch (uploadErr) {
        if (netDelta !== 0) {
          await adjustStorageBytes(userId, -netDelta).catch(() => {});
        }
        throw uploadErr;
      }

      // 4. Point the object at the new content; persist evicted-trimmed history.
      object.key = newKey;
      object.b2FileId = uploadResult.b2FileId;
      object.size = newSize;
      object.iv = iv;
      if (dek) object.encryptedDEK = dek;
      object.versions = kept;
      object.updatedAt = new Date();
      await object.save();

      // 5. Best-effort: drop evicted version blobs + reconcile bucket stats.
      if (evicted.length > 0) {
        await deleteObjects(
          bucket.b2BucketId,
          evicted.flatMap(collectVersionB2Keys),
        );
      }
      if (netDelta !== 0) {
        await updateBucketStats(object.bucketId.toString(), 0, netDelta);
      }

      return NextResponse.json({ success: true, object });
    }

    // Legacy presigned-url flow. Deprecated and NOT versioned — the docs editor
    // now uses the direct binary upload path above.
    object.iv = iv;
    await object.save();

    const uploadUrl = await getUploadUrl(
      bucket.b2BucketId,
      object.key,
      "application/octet-stream",
    );

    return NextResponse.json({ uploadUrl });
  } catch (error: unknown) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    if (message === "QUOTA_EXCEEDED") {
      return NextResponse.json(
        { error: "storage_quota_exceeded" },
        { status: 402 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

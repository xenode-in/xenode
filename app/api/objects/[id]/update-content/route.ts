import { NextRequest, NextResponse } from "next/server";
import {
  requireAccessContext,
  objectFilter,
  bucketOwnershipClause,
  isAuthzError,
  toJsonResponse,
} from "@/lib/authz";
import { assertScopeAction } from "@/lib/authz/policy";
import dbConnect from "@/lib/mongodb";
import StorageObject from "@/models/StorageObject";
import Bucket from "@/models/Bucket";
import { getUploadUrl, uploadObject, deleteObjects } from "@/lib/b2/objects";
import { updateBucketStats, adjustStorageBytes } from "@/lib/metering/usage";
import { adjustOrgStorage } from "@/lib/orgs/billing/orgUsage";
import { resolveWorkspace } from "@/lib/workspace/resolve";
import { parseBaseRevision, revisionFilter, REVISION_HEADER } from "@/lib/storage/revisions";
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
    assertScopeAction(ctx, "write");
    const userId = ctx.userId;
    const adjustWorkspaceStorage = (delta: number) =>
      ctx.scope.type === "personal"
        ? adjustStorageBytes(userId, delta)
        : adjustOrgStorage(ctx.scope.orgId, delta);
    const baseRevision = parseBaseRevision(request.headers.get(REVISION_HEADER));
    if (Number.isNaN(baseRevision)) {
      return NextResponse.json(
        { error: "Invalid base revision", code: "invalid_base_revision" },
        { status: 400 },
      );
    }
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
    if (baseRevision !== null && (object.revision ?? 0) !== baseRevision) {
      return NextResponse.json(
        { error: "The object changed since it was opened", code: "revision_conflict", revision: object.revision ?? 0 },
        { status: 409 },
      );
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

      // 1. Snapshot the current content before mutating fields. Spreadsheet
      // originals are pinned and never duplicated when the current pointer is
      // already referencing that immutable source ciphertext.
      const existingVersions = [...(object.versions || [])];
      let versionCandidates: typeof existingVersions;
      if (object.mediaCategory === "excel") {
        let original = existingVersions.find((version) => version.isOriginal);
        if (!original && existingVersions.length > 0) {
          original = existingVersions[existingVersions.length - 1];
          original.isOriginal = true;
          original.sharesCurrentContent = original.key === object.key;
        }
        if (!original) {
          original = snapshotCurrentAsVersion(object, userId, {
            isOriginal: true,
            sharesCurrentContent: true,
          });
          existingVersions.push(original);
        }
        const currentIsPinnedOriginal = original.key === object.key;
        if (currentIsPinnedOriginal) original.sharesCurrentContent = false;
        versionCandidates = currentIsPinnedOriginal
          ? existingVersions
          : [snapshotCurrentAsVersion(object, userId), ...existingVersions];
      } else {
        versionCandidates = [
          snapshotCurrentAsVersion(object, userId),
          ...existingVersions,
        ];
      }
      const { kept, evicted } = evictOverflow(versionCandidates);
      const evictedBytes = versionsTotalBytes(evicted);
      const newSize = buffer.byteLength;

      // 2. Reserve quota FIRST (atomic + enforced). The retained old version now
      //    also occupies space, so the net delta is +newSize − evictedBytes.
      const netDelta = newSize - evictedBytes;
      if (netDelta !== 0) {
        await adjustWorkspaceStorage(netDelta); // throws QUOTA_EXCEEDED
      }

      // 3. Upload NEW content to a fresh key. Roll back the reservation on fail.
      const newKey = newObjectKey(userId, resolveWorkspace(ctx).keyPrefix);
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
          await adjustWorkspaceStorage(-netDelta).catch(() => {});
        }
        throw uploadErr;
      }

      // 4. Atomically point the object at the new ciphertext. A second editor
      // may have saved while this upload was in flight, so the revision guard
      // must be part of the database write rather than only a preflight check.
      const expectedRevision = baseRevision ?? (object.revision ?? 0);
      const update = await StorageObject.updateOne(
        { _id: object._id, ...revisionFilter(expectedRevision) },
        {
          $set: {
            key: newKey,
            b2FileId: uploadResult.b2FileId,
            size: newSize,
            iv,
            ...(dek ? { encryptedDEK: dek } : {}),
            versions: kept,
            updatedAt: new Date(),
          },
          $inc: { revision: 1 },
        },
      );
      if (update.matchedCount !== 1) {
        await deleteObjects(bucket.b2BucketId, [newKey]).catch(() => {});
        if (netDelta !== 0) await adjustWorkspaceStorage(-netDelta).catch(() => {});
        const latest = await StorageObject.findById(object._id).select("revision").lean();
        return NextResponse.json(
          { error: "The object changed since it was opened", code: "revision_conflict", revision: latest?.revision ?? expectedRevision },
          { status: 409 },
        );
      }
      const updatedObject = await StorageObject.findById(object._id);

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

      return NextResponse.json({ success: true, object: updatedObject, revision: updatedObject?.revision ?? expectedRevision + 1 });
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

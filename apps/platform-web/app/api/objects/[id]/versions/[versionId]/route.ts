import { NextRequest, NextResponse } from "next/server";
import {
  requireAccessContext,
  assertObjectAccess,
  bucketOwnershipClause,
  isAuthzError,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import { deleteObjects } from "@/lib/b2/objects";
import { adjustStorageBytes, updateBucketStats } from "@/lib/metering/usage";
import { adjustOrgStorage } from "@/lib/orgs/billing/orgUsage";
import {
  collectVersionB2Keys,
  versionsTotalBytes,
} from "@/lib/storage/versions";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/objects/[id]/versions/[versionId]
 * Permanently delete a single historical version: its B2 blob(s) are removed and
 * the freed bytes are returned to the user's quota. The current content and other
 * versions are untouched.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const ctx = await requireAccessContext(request);
    const { id, versionId } = await params;

    const object = await assertObjectAccess(ctx, id, "delete");

    const versions = object.versions || [];
    const target = versions.find((v) => v.versionId === versionId);
    if (!target) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }
    if (target.isOriginal) {
      return NextResponse.json(
        { error: "The protected original cannot be deleted", code: "original_version_protected" },
        { status: 409 },
      );
    }

    await dbConnect();
    const bucket = await Bucket.findOne({
      _id: object.bucketId,
      ...bucketOwnershipClause(ctx),
    })
      .select("b2BucketId")
      .lean<{ b2BucketId: string }>();
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    const remainingVersions = versions.filter((v) => v.versionId !== versionId);
    const protectedKeys = new Set([
      object.key,
      ...(object.chunks ?? []).map((chunk) => chunk.key),
      ...remainingVersions.flatMap(collectVersionB2Keys),
    ]);
    const keysToDelete = collectVersionB2Keys(target).filter(
      (key) => !protectedKeys.has(key),
    );
    const freedBytes =
      keysToDelete.length > 0 ? versionsTotalBytes([target]) : 0;

    object.versions = remainingVersions;
    await object.save();

    // Remove only blobs that are not still referenced by current/original data.
    await deleteObjects(bucket.b2BucketId, keysToDelete);
    if (freedBytes > 0) {
      if (ctx.scope.type === "personal") {
        await adjustStorageBytes(ctx.userId, -freedBytes);
      } else {
        await adjustOrgStorage(ctx.scope.orgId, -freedBytes);
      }
      await updateBucketStats(object.bucketId.toString(), 0, -freedBytes);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

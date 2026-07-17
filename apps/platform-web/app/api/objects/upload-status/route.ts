import { NextRequest, NextResponse } from "next/server";
import {
  bucketOwnershipClause,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import { listObjects } from "@/lib/b2/objects";
import { orgObjectKeyPrefix, teamObjectKeyPrefix } from "@/lib/orgs/storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/objects/upload-status?bucketId=...&fileId=...
 *
 * Resume helper. Given a logical upload key (`fileId`), reports which of its B2
 * objects already exist so the client can re-PUT only the missing pieces after
 * an interruption or reload. Returns the completed chunk indices, plus whether
 * the main / `-thumb` blobs exist and their sizes.
 *
 * Read-only and E2EE-safe: it only lists opaque object keys under the user's
 * own prefix; it never touches ciphertext or the encrypted metadata.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);

    const { searchParams } = new URL(request.url);
    const bucketId = searchParams.get("bucketId");
    const fileId = searchParams.get("fileId");

    if (!bucketId || !fileId) {
      return NextResponse.json(
        { error: "bucketId and fileId required" },
        { status: 400 },
      );
    }

    // Ownership guard: the logical key must live under the caller's space prefix.
    const allowedSystemPrefix =
      ctx.spaceType === "organization"
        ? orgObjectKeyPrefix(ctx.organizationId!)
        : ctx.spaceType === "team"
          ? teamObjectKeyPrefix(ctx.organizationId!, ctx.teamId!)
          : `users/${ctx.userId}/`;
    if (!fileId.startsWith(allowedSystemPrefix)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      ...bucketOwnershipClause(ctx),
    });
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    // List everything under the logical key: the bare key (single-PUT main),
    // `${fileId}-chunk-N`, and `${fileId}-thumb`. Paginate to be safe.
    const found = new Map<string, number>(); // key -> size
    let continuationToken: string | undefined;
    do {
      const page = await listObjects(
        bucket.b2BucketId,
        fileId,
        1000,
        continuationToken,
      );
      for (const obj of page.objects) found.set(obj.key, obj.size);
      continuationToken = page.isTruncated
        ? page.nextContinuationToken
        : undefined;
    } while (continuationToken);

    const chunkPrefix = `${fileId}-chunk-`;
    const completedChunks: number[] = [];
    for (const key of found.keys()) {
      if (key.startsWith(chunkPrefix)) {
        const idx = Number(key.slice(chunkPrefix.length));
        if (Number.isInteger(idx)) completedChunks.push(idx);
      }
    }
    completedChunks.sort((a, b) => a - b);

    return NextResponse.json({
      fileId,
      mainExists: found.has(fileId),
      mainSize: found.get(fileId) ?? 0,
      thumbExists: found.has(`${fileId}-thumb`),
      completedChunks,
    });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to read upload status";
    const statusCode = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}

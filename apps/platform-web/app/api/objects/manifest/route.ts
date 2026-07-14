/**
 * GET /api/objects/manifest?bucketId=...&prefix=...&mediaCategory=...
 *
 * Returns the complete lightweight display manifest for a bucket slice.
 * Binary data, preview credentials, encrypted file keys, and signed URLs are
 * deliberately excluded. Clients can build folders, sorting, filters, and
 * virtualized placeholders immediately, then resolve thumbnail URLs only for
 * visible rows through /api/objects/thumbnail/batch.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  bucketOwnershipClause,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { logRequest } from "@/lib/logRequest";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";

export const dynamic = "force-dynamic";

const MANIFEST_PROJECTION =
  "key size contentType encryptedContentType thumbnail tags position starred " +
  "lastAccessedAt uploadSource createdAt updatedAt isEncrypted encryptedName " +
  "encryptedDisplayName mediaCategory aspectRatio syncContentFp";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const ctx = await requireAccessContext(request);
    userId = ctx.userId;

    const { searchParams } = request.nextUrl;
    const bucketId = searchParams.get("bucketId");
    const requestedPrefix = searchParams.get("prefix");
    const mediaCategory = searchParams.get("mediaCategory");
    const contentType = searchParams.get("contentType");
    const excludeMobileBackup =
      searchParams.get("excludeMobileBackup") === "true";

    if (!bucketId) {
      statusCode = 400;
      errorMessage = "bucketId is required";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      ...bucketOwnershipClause(ctx),
    })
      .select("_id userId")
      .lean<{ _id: unknown; userId: string }>();

    if (!bucket) {
      statusCode = 404;
      errorMessage = "Bucket not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const userPrefix = `users/${userId}/`;
    if (
      requestedPrefix !== null &&
      bucket.userId === "system" &&
      !requestedPrefix.startsWith(userPrefix)
    ) {
      statusCode = 403;
      errorMessage = "Access denied to this folder";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const query: Record<string, unknown> = {
      bucketId,
      deletedAt: { $exists: false },
      isSidecar: { $ne: true },
    };

    const prefix =
      requestedPrefix ?? (bucket.userId === "system" ? userPrefix : null);
    if (prefix !== null) {
      query.key = { $regex: `^${escapeRegex(prefix)}` };
    }

    if (mediaCategory) {
      query.mediaCategory = mediaCategory;
    } else if (contentType) {
      query.contentType = {
        $regex: `^${escapeRegex(contentType)}/`,
        $options: "i",
      };
    }

    if (excludeMobileBackup) {
      query.$nor = [
        { mediaCategory: "image", uploadSource: "mobile_backup" },
        {
          mediaCategory: "image",
          syncContentFp: { $exists: true, $ne: null },
        },
      ];
    }

    const docs = await StorageObject.find(query)
      .select(MANIFEST_PROJECTION)
      .sort({ createdAt: -1, _id: -1 })
      .lean<Array<Record<string, unknown>>>();

    const items = docs.map((doc) => ({
      ...doc,
      _id: String(doc._id),
    }));

    const response = NextResponse.json({ count: items.length, items });
    response.headers.set("Cache-Control", "private, max-age=30");
    return response;
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      statusCode = error.status;
      errorMessage = error.message;
      return toJsonResponse(error);
    }
    statusCode =
      error instanceof Error && error.message === "Unauthorized" ? 401 : 500;
    errorMessage =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  } finally {
    logRequest({
      userId,
      method: request.method,
      endpoint: request.nextUrl.pathname,
      statusCode,
      durationMs: Date.now() - startTime,
      ip: request.headers.get("x-forwarded-for") || "unknown",
      userAgent: request.headers.get("user-agent") || "unknown",
    });
  }
}

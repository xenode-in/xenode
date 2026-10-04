/**
 * POST /api/objects/bulk-delete
 *
 * Move a selection to the Bin in one request. Body: `{ bucketId, ids }`
 * (at most 10 000 ids). Reply: `{ success, deletedCount, removedCount }` where
 * `removedCount` includes folder subtrees and sidecars binned with the
 * selection.
 *
 * Soft delete only: encrypted blobs and metering stay until the Bin purge
 * contract removes them; shares and album references are retired.
 */

import { NextRequest, NextResponse } from "next/server";
import { DriveUploadCommitError } from "@xenode/database";
import {
  bucketOwnershipClause,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { logRequest } from "@/lib/logRequest";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import { enforceStorageAccess } from "@/lib/subscriptions/service";
import { binObjectsInSpace } from "@/lib/storage/bin-objects";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const ctx = await requireAccessContext(request, "delete");
    userId = ctx.userId;
    await enforceStorageAccess(userId);

    let body: { bucketId?: unknown; ids?: unknown };
    try {
      body = await request.json();
    } catch {
      statusCode = 400;
      errorMessage = "Invalid JSON";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    if (typeof body.bucketId !== "string" || !body.bucketId) {
      statusCode = 400;
      errorMessage = "bucketId is required";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    if (!Array.isArray(body.ids)) {
      statusCode = 400;
      errorMessage = "ids must be an array";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    if (body.ids.length === 0) {
      return NextResponse.json({ success: true, deletedCount: 0, removedCount: 0 });
    }

    await dbConnect();
    const bucket = await Bucket.findOne({
      _id: body.bucketId,
      ...bucketOwnershipClause(ctx),
    })
      .select("_id")
      .lean();
    if (!bucket) {
      statusCode = 404;
      errorMessage = "Bucket not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const selected = new Set(body.ids.map(String));
    const result = await binObjectsInSpace(ctx, [...selected]);
    return NextResponse.json({
      success: true,
      deletedCount: result.objectIds.filter((id) => selected.has(id)).length,
      removedCount: result.binnedCount,
    });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      statusCode = error.status;
      errorMessage = error.message;
      return toJsonResponse(error);
    }
    if (error instanceof DriveUploadCommitError) {
      statusCode = error.status;
      errorMessage = error.message;
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof Error && error.name === "SubscriptionRequired") {
      statusCode = 402;
      errorMessage = "Active subscription required";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    statusCode = 500;
    errorMessage = "Internal server error";
    console.error("[bulk-delete] Failed", error);
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
      errorMessage,
    });
  }
}

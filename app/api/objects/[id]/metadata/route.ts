import { NextRequest, NextResponse } from "next/server";
import {
  bucketOwnershipClause,
  isAuthzError,
  objectFilter,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import StorageObject from "@/models/StorageObject";
import Bucket from "@/models/Bucket";
import { logRequest } from "@/lib/logRequest";

export const dynamic = "force-dynamic";

/**
 * GET /api/objects/[id]/metadata
 * Fetches the encrypted metadata for a specific storage object.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  const { id } = await params;
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const ctx = await requireAccessContext(request);
    userId = ctx.userId;

    if (!id) {
      statusCode = 400;
      errorMessage = "Object ID is required";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    await dbConnect();

    // 1. Fetch the object
    const object = await StorageObject.findOne(objectFilter(ctx, id))
      .select("bucketId encryptedMetadata")
      .lean();

    if (!object) {
      statusCode = 404;
      errorMessage = "Object not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    // 2. Security check: Ensure the user owns the bucket or it's a system bucket and the key prefix matches
    const bucket = await Bucket.findOne({
      _id: object.bucketId,
      ...bucketOwnershipClause(ctx),
    }).lean();

    if (!bucket) {
      statusCode = 403;
      errorMessage = "Access denied";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    // 3. Return the encrypted metadata
    return NextResponse.json({
      encryptedMetadata: object.encryptedMetadata || null,
    });
  } catch (error: any) {
    if (isAuthzError(error)) {
      statusCode = error.status;
      errorMessage = error.message;
      return toJsonResponse(error);
    }
    statusCode = error.message === "Unauthorized" ? 401 : 500;
    errorMessage = error.message || "Internal server error";
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  } finally {
    logRequest({
      userId,
      method: "GET",
      endpoint: `/api/objects/${id}/metadata`,
      statusCode,
      durationMs: Date.now() - startTime,
      ip: request.headers.get("x-forwarded-for") || "unknown",
      userAgent: request.headers.get("user-agent") || "unknown",
      errorMessage,
    });
  }
}

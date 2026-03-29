import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { logRequest } from "@/lib/logRequest";

export const dynamic = "force-dynamic";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";

const LIST_PROJECTION =
  "key size contentType encryptedContentType thumbnail tags position createdAt " +
  "isEncrypted encryptedName encryptedDisplayName mediaCategory";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/** GET /api/objects?bucketId=xxx&limit=50&before=<ISO>&contentType=image */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const session = await requireAuth(request);
    userId = session.user.id;

    const { searchParams } = request.nextUrl;
    const bucketId = searchParams.get("bucketId");
    if (!bucketId) {
      statusCode = 400;
      errorMessage = "Bucket ID is required";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(
        1,
        parseInt(searchParams.get("limit") || String(DEFAULT_PAGE_SIZE), 10),
      ),
    );

    // Cursor: ISO timestamp of the last item from the previous page
    const before = searchParams.get("before");

    const contentTypeFilter = searchParams.get("contentType");
    const mediaCategoryFilter = searchParams.get("mediaCategory");

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      $or: [{ userId }, { userId: "system" }],
    })
      .select("_id userId")
      .lean();

    if (!bucket) {
      statusCode = 404;
      errorMessage = "Bucket not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const query: Record<string, unknown> = {
      bucketId,
      deletedAt: { $exists: false },
    };

    if (bucket.userId === "system") {
      const prefix = `users/${userId}/`;
      query.key = { $gte: prefix, $lt: prefix + "\uffff" };
    }

    if (mediaCategoryFilter) {
      query.mediaCategory = mediaCategoryFilter;
    } else if (contentTypeFilter) {
      query.contentType = { $regex: `^${contentTypeFilter}/`, $options: "i" };
    }

    // Apply cursor — only fetch items older than the last seen createdAt
    if (before) {
      const cursorDate = new Date(before);
      if (isNaN(cursorDate.getTime())) {
        statusCode = 400;
        errorMessage = "Invalid cursor: 'before' must be a valid ISO timestamp";
        return NextResponse.json(
          { error: errorMessage },
          { status: statusCode },
        );
      }
      query.createdAt = { $lt: cursorDate };
    }

    // Fetch limit + 1 to detect if another page exists — avoids countDocuments
    const rawObjects = await StorageObject.find(query)
      .select(LIST_PROJECTION)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean();

    const hasNextPage = rawObjects.length > limit;
    const objects = hasNextPage ? rawObjects.slice(0, limit) : rawObjects;

    // Cursor points to the createdAt of the last item in this page
    const nextCursor =
      hasNextPage && objects.length > 0
        ? (objects[objects.length - 1].createdAt as Date).toISOString()
        : null;

    return NextResponse.json({
      objects,
      pagination: {
        limit,
        hasNextPage,
        nextCursor, // pass this as `before=` on the next request
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      statusCode = 401;
      errorMessage = "Unauthorized";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    statusCode = 500;
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
      errorMessage,
    });
  }
}

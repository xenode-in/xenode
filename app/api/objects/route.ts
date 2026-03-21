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

/** GET /api/objects?bucketId=xxx&page=1&limit=50&contentType=image - List objects in a bucket */
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

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(searchParams.get("limit") || String(DEFAULT_PAGE_SIZE), 10)),
    );
    const skip = (page - 1) * limit;
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

    const query: Record<string, unknown> = { bucketId };
    if (bucket.userId === "system") {
      const prefix = `users/${userId}/`;
      query.key = { $gte: prefix, $lt: prefix + "\uffff" };
    }
    if (mediaCategoryFilter) {
      query.mediaCategory = mediaCategoryFilter;
    } else if (contentTypeFilter) {
      query.contentType = { $regex: `^${contentTypeFilter}/`, $options: "i" };
    }

    const [total, objects] = await Promise.all([
      StorageObject.countDocuments(query),
      StorageObject.find(query)
        .select(LIST_PROJECTION)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return NextResponse.json({
      objects,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      statusCode = 401;
      errorMessage = "Unauthorized";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    statusCode = 500;
    errorMessage = error instanceof Error ? error.message : "Internal server error";
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

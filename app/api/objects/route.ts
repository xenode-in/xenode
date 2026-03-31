import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { logRequest } from "@/lib/logRequest";

export const dynamic = "force-dynamic";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";

const LIST_PROJECTION =
  "key size contentType encryptedContentType thumbnail tags position createdAt " +
  "isEncrypted encryptedName encryptedDisplayName mediaCategory " +
  "optimizedKey optimizedEncryptedDEK optimizedIV optimizedSize aspectRatio";

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

    // Sort options: "date", "size", "type", "name" (name is functionally handled client-side but we map it here just in case)
    const sortByParam = searchParams.get("sortBy") || "date";
    const sortDirParam = searchParams.get("sortDir") || "desc";
    const sortDir = sortDirParam === "asc" ? 1 : -1;

    let sortField = "createdAt";
    if (sortByParam === "size") sortField = "size";
    else if (sortByParam === "type") sortField = "contentType";
    // For anything else (like "name" which is E2EE), default server sort is createdAt

    const sortConfig: any = { [sortField]: sortDir, _id: -1 };

    // Cursor: base64 encoded JSON { v: lastValue, id: lastId }
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

    // Apply composite cursor pagination
    if (before) {
      try {
        const cursorPayload = Buffer.from(before, "base64").toString("utf8");
        const cursorData = JSON.parse(cursorPayload);
        const { v, id } = cursorData;

        let typedV = v;
        if (sortField === "createdAt" && v) {
          typedV = new Date(v);
        }

        const operator = sortDir === 1 ? "$gt" : "$lt";

        // Tie-breaker pagination mapping: value is strictly > / < depending on sortDir,
        // OR the value is equal but the _id is smaller (since we always sort _id: -1)
        query.$or = [
          { [sortField]: { [operator]: typedV } },
          { [sortField]: typedV, _id: { $lt: id } },
        ];
      } catch (err) {
        statusCode = 400;
        errorMessage = "Invalid cursor format";
        return NextResponse.json(
          { error: errorMessage },
          { status: statusCode },
        );
      }
    }

    // Fetch limit + 1 to detect if another page exists — avoids countDocuments
    const rawObjects = await StorageObject.find(query)
      .select(LIST_PROJECTION)
      .sort(sortConfig)
      .limit(limit + 1)
      .lean();

    const hasNextPage = rawObjects.length > limit;
    const objects = hasNextPage ? rawObjects.slice(0, limit) : rawObjects;

    // Cursor points to the last item in this page
    let nextCursor = null;
    if (hasNextPage && objects.length > 0) {
      const lastItem = objects[objects.length - 1];
      const val = lastItem[sortField as keyof typeof lastItem];
      const cursorObj = {
        v: val,
        id: lastItem._id,
      };
      nextCursor = Buffer.from(JSON.stringify(cursorObj)).toString("base64");
    }

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

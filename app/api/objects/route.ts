import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { getSignedFileUrl } from "@/lib/b2/cdn";
import { logRequest } from "@/lib/logRequest";
import {
  folderResponseKey,
  folderVersionKey,
} from "@/lib/realtime/cache-keys";
import { withRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";

const LIST_PROJECTION =
  "key size contentType encryptedContentType thumbnail tags position starred lastAccessedAt uploadSource createdAt " +
  "isEncrypted encryptedName encryptedDisplayName mediaCategory " +
  "optimizedKey optimizedEncryptedDEK optimizedIV optimizedSize aspectRatio syncContentFp";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

    // When the client needs all objects at once (e.g. for E2EE name sorting
    // where the server can't sort encrypted names), it passes fetchAll=true.
    // We skip pagination and return every object in a single response.
    // The payload is just lightweight metadata so this is safe even for
    // large libraries.
    const fetchAll = searchParams.get("fetchAll") === "true";

    // Bin mode: list soft-deleted objects (the Bin) instead of live ones.
    const deleted = searchParams.get("deleted") === "true";

    // Starred mode: restrict to the user's favourites.
    const starredOnly = searchParams.get("starred") === "true";

    // Sort options: "date", "size", "type", "name" (name is functionally handled client-side but we map it here just in case)
    const sortByParam = searchParams.get("sortBy") || (deleted ? "deleted" : "date");
    const sortDirParam = searchParams.get("sortDir") || "desc";
    const sortDir = sortDirParam === "asc" ? 1 : -1;

    let sortField = "createdAt";
    if (sortByParam === "size") sortField = "size";
    else if (sortByParam === "type") sortField = "contentType";
    // Bin defaults to most-recently-deleted first.
    else if (sortByParam === "deleted") sortField = "deletedAt";
    // "Recent" view: most-recently-opened first.
    else if (sortByParam === "accessed") sortField = "lastAccessedAt";
    // For anything else (like "name" which is E2EE), default server sort is createdAt

    const sortConfig: Record<string, 1 | -1> = {
      [sortField]: sortDir,
      _id: -1,
    };

    // Cursor: base64 encoded JSON { v: lastValue, id: lastId }
    const before = searchParams.get("before");

    const contentTypeFilter = searchParams.get("contentType");
    const mediaCategoryFilter = searchParams.get("mediaCategory");
    const excludeMobileBackup =
      searchParams.get("excludeMobileBackup") === "true";
    const prefix = searchParams.get("prefix");

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      $or: [{ userId }, { userId: "system" }],
    })
      // b2BucketId is needed to sign per-object thumbnail / optimized URLs
      // below — without it we'd have to make a follow-up DB query in the
      // map, defeating the purpose of pre-attaching signed URLs.
      .select("_id userId b2BucketId")
      .lean();

    if (!bucket) {
      statusCode = 404;
      errorMessage = "Bucket not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    if (
      prefix !== null &&
      bucket.userId === "system" &&
      !prefix.startsWith(`users/${userId}/`)
    ) {
      statusCode = 403;
      errorMessage = "Access denied to this folder";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const canUseFolderCache =
      prefix !== null &&
      !before &&
      !fetchAll &&
      !deleted &&
      !starredOnly &&
      !excludeMobileBackup &&
      !contentTypeFilter &&
      !mediaCategoryFilter;
    let cacheKey: string | null = null;

    if (canUseFolderCache && prefix !== null) {
      const cachePrefix = prefix;
      const version =
        (await withRedis((redis) =>
          redis.get(
            folderVersionKey(session.user.id, bucketId, cachePrefix),
          ),
        )) ?? "0";
      cacheKey = folderResponseKey({
        userId: session.user.id,
        bucketId,
        prefix: cachePrefix,
        version,
        limit,
        sortBy: sortByParam,
        sortDir: sortDirParam,
      });
      const cached = await withRedis((redis) => redis.get(cacheKey!));
      if (cached) {
        return NextResponse.json(JSON.parse(cached), {
          headers: { "x-xenode-cache": "HIT" },
        });
      }
    }

    const query: Record<string, unknown> = {
      bucketId,
      deletedAt: { $exists: deleted },
      isSidecar: { $ne: true }, // exclude subtitle/audio sidecar files from listings
    };

    if (starredOnly) {
      query.starred = true;
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

    if (bucket.userId === "system") {
      const prefix = `users/${userId}/`;
      query.key = { $gte: prefix, $lt: prefix + "\uffff" };
    }

    if (prefix !== null) {
      query.key = {
        $regex: `^${escapeRegex(prefix)}[^/]+/?$`,
      };
    }

    if (mediaCategoryFilter) {
      query.mediaCategory = mediaCategoryFilter;
    } else if (contentTypeFilter) {
      query.contentType = { $regex: `^${contentTypeFilter}/`, $options: "i" };
    }

    // Apply composite cursor pagination (skipped when fetchAll is true)
    if (before && !fetchAll) {
      try {
        const cursorPayload = Buffer.from(before, "base64").toString("utf8");
        const cursorData = JSON.parse(cursorPayload);
        const { v, id } = cursorData;

        let typedV = v;
        if (
          (sortField === "createdAt" ||
            sortField === "deletedAt" ||
            sortField === "lastAccessedAt") &&
          v
        ) {
          typedV = new Date(v);
        }

        const operator = sortDir === 1 ? "$gt" : "$lt";

        // Tie-breaker pagination mapping: value is strictly > / < depending on sortDir,
        // OR the value is equal but the _id is smaller (since we always sort _id: -1)
        query.$or = [
          { [sortField]: { [operator]: typedV } },
          { [sortField]: typedV, _id: { $lt: id } },
        ];
      } catch {
        statusCode = 400;
        errorMessage = "Invalid cursor format";
        return NextResponse.json(
          { error: errorMessage },
          { status: statusCode },
        );
      }
    }

    // When fetchAll is true, return every matching object (no limit).
    // Otherwise fetch limit + 1 to detect if another page exists.
    const dbQuery = StorageObject.find(query)
      .select(deleted ? `${LIST_PROJECTION} deletedAt` : LIST_PROJECTION)
      .sort(sortConfig);

    const rawObjects = fetchAll
      ? await dbQuery.lean()
      : await dbQuery.limit(limit + 1).lean();

    const hasNextPage = fetchAll ? false : rawObjects.length > limit;
    const baseObjects =
      hasNextPage ? rawObjects.slice(0, limit) : rawObjects;

    // Pre-sign thumbnail and optimized-preview URLs at list time.
    //
    // generateFileToken() is time-windowed (rounded to the start of the
    // current hour), so the URLs are byte-identical for every object key
    // within the same hour — Azure CDN can cache them aggressively at the
    // edge. Doing this here saves the client a round-trip per asset:
    // before, the gallery used to call /api/objects/thumbnail?key=X for
    // every single thumbnail (3000+ extra HTTP calls on a big library).
    //
    // The per-object signing cost is just two HMAC-SHA256s — well under
    // 1ms at this scale and dwarfed by the Mongo round-trip we already
    // paid above.
    const objects = baseObjects.map((o) => {
      const out: typeof o & {
        thumbnailUrl?: string;
        optimizedUrl?: string;
      } = o;
      if (o.thumbnail) {
        out.thumbnailUrl = getSignedFileUrl(bucket.b2BucketId, o.thumbnail);
      }
      if (o.optimizedKey) {
        out.optimizedUrl = getSignedFileUrl(
          bucket.b2BucketId,
          o.optimizedKey,
        );
      }
      return out;
    });

    // Cursor points to the last item in this page (not needed for fetchAll)
    let nextCursor = null;
    if (!fetchAll && hasNextPage && objects.length > 0) {
      const lastItem = objects[objects.length - 1];
      const val = lastItem[sortField as keyof typeof lastItem];
      const cursorObj = {
        v: val,
        id: lastItem._id,
      };
      nextCursor = Buffer.from(JSON.stringify(cursorObj)).toString("base64");
    }

    const responseBody = {
      objects,
      pagination: {
        limit: fetchAll ? rawObjects.length : limit,
        hasNextPage,
        nextCursor, // pass this as `before=` on the next request
      },
    };

    if (cacheKey) {
      await withRedis((redis) =>
        redis.set(cacheKey!, JSON.stringify(responseBody), "EX", 30),
      );
    }

    return NextResponse.json(responseBody, {
      headers: { "x-xenode-cache": cacheKey ? "MISS" : "BYPASS" },
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

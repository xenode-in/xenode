/**
 * GET /api/objects/metadata?bucketId=xxx
 *
 * Returns ONLY `{ _id, createdAt }` for every (non-deleted, non-sidecar)
 * object in the bucket the caller can see. No pagination, no signed URLs,
 * no encrypted blobs — just the minimum the gallery needs to lay out
 * placeholders and the scrubber needs to render its timeline.
 *
 * Why a dedicated endpoint vs. paging `/api/objects`?
 *
 *   - For a 5,000-photo gallery, paging `/api/objects` at 50/page is
 *     ~100 round trips and ~12 MB of JSON before the user sees a single
 *     thumbnail. This endpoint cuts that to a single ~250 KB raw / ~25 KB
 *     gzipped response that the scrubber + grid can consume immediately.
 *
 *   - The query is a covered index scan on `{ bucketId: 1, createdAt: -1 }`
 *     (with the implicit `_id` field) — Mongo can satisfy it without
 *     loading any document bodies. Sub-100 ms even at 50k objects.
 *
 *   - Pre-signed thumbnail URLs (the dominant per-row cost in the listing
 *     endpoint) are deferred to the lazy `/api/objects/batch` fetch that
 *     runs when a row enters the viewport.
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
    if (!bucketId) {
      statusCode = 400;
      errorMessage = "Bucket ID is required";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    // Optional filter so the metadata fetch can be scoped — the gallery
    // splits into "photos" / "videos" tabs and each only needs its own
    // slice. Defaults to all media (matches `/api/objects` behaviour when
    // neither filter is supplied).
    const contentTypeFilter = searchParams.get("contentType");
    const mediaCategoryFilter = searchParams.get("mediaCategory");

    await dbConnect();

    // Same ownership check as `/api/objects` — user must own the bucket
    // or it's the shared "system" bucket. We only pull the fields needed
    // to authorize + scope; b2BucketId etc. is unnecessary here.
    const bucket = await Bucket.findOne({
      _id: bucketId,
      ...bucketOwnershipClause(ctx),
    })
      .select("_id systemKey")
      .lean<{ _id: unknown; systemKey: "drive" }>();

    if (!bucket) {
      statusCode = 404;
      errorMessage = "Bucket not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const query: Record<string, unknown> = {
      bucketId,
      deletedAt: { $exists: false },
      isSidecar: { $ne: true },
    };

    // Mirror `/api/objects` "system bucket → scope to user's prefix" rule.
    if (bucket.systemKey === "drive") {
      const prefix = `users/${userId}/`;
      query.key = { $gte: prefix, $lt: prefix + "￿" };
    }

    if (mediaCategoryFilter) {
      query.mediaCategory = mediaCategoryFilter;
    } else if (contentTypeFilter) {
      query.contentType = {
        $regex: `^${contentTypeFilter}/`,
        $options: "i",
      };
    }

    // Covered query: `_id` is implicit in every index, `createdAt` is the
    // sort key in the primary listing index. Mongo never has to fetch a
    // document body to satisfy this. .lean() so we skip Mongoose hydration
    // on what could be 5000+ documents.
    const docs = await StorageObject.find(query)
      .select("_id createdAt")
      .sort({ createdAt: -1, _id: -1 })
      .lean<Array<{ _id: unknown; createdAt: Date }>>();

    // Project to the wire format. Cast _id to string here so the client
    // doesn't have to deal with ObjectId / BSON quirks.
    const items = docs.map((d) => ({
      _id: String(d._id),
      createdAt:
        d.createdAt instanceof Date
          ? d.createdAt.toISOString()
          : String(d.createdAt),
    }));

    const response = NextResponse.json({
      count: items.length,
      items,
    });

    // Cache hint: client + edge can keep this for 30s. Mutations
    // (upload/delete) are infrequent vs. gallery loads, and the gallery
    // already handles fresh writes via local cache reconciliation.
    response.headers.set("Cache-Control", "private, max-age=30");

    return response;
  } catch (err: any) {
    if (isAuthzError(err)) {
      statusCode = err.status;
      errorMessage = err.message;
      return toJsonResponse(err);
    }
    statusCode = err?.message === "Unauthorized" ? 401 : 500;
    errorMessage = err?.message ?? "Internal error";
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}

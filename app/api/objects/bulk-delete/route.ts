/**
 * POST /api/objects/bulk-delete
 *
 * Soft-delete many objects in a single request → they move to the Bin.
 * Replaces the client's old "loop DELETE /api/objects/[id] N times" pattern,
 * which made deleting a 3000+ photo selection take thousands of round trips.
 *
 * Body:  { bucketId: string, ids: string[] }
 * Reply: { success: true, deletedCount, removedCount }
 *          deletedCount = primary objects binned (what the user selected)
 *          removedCount = deletedCount + cascaded sidecars
 *
 * Semantics match the single DELETE /api/objects/[id]:
 *   - Soft-delete (sets `deletedAt`). The encrypted B2 blobs are deliberately
 *     RETAINED so the item can be restored within the 30-day window; they're
 *     purged later via /api/objects/purge (empty bin / delete forever) or the
 *     /api/cron/purge-bin job.
 *   - Storage metering is NOT decremented here — the bytes still occupy B2, so
 *     binned items keep counting against quota until they're actually purged.
 *   - Sidecars (subtitles / extra audio tracks) cascade.
 *   - ShareLink / DirectShare rows are revoked (a binned item shouldn't stay
 *     publicly reachable).
 *
 * Only the caller's own, not-already-deleted objects in the named bucket are
 * touched — ids that don't resolve are silently ignored (already gone/binned).
 */

import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { requireAuth } from "@/lib/auth/session";
import { logRequest } from "@/lib/logRequest";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import ShareLink from "@/models/ShareLink";
import DirectShare from "@/models/DirectShare";
import { enforceStorageAccess } from "@/lib/subscriptions/service";
import { removeObjectsFromAlbums } from "@/lib/albums/cleanup";
import {
  parentPrefixForKey,
  publishSyncEvent,
} from "@/lib/realtime/publish";

export const dynamic = "force-dynamic";

// Upper bound on ids per request. Comfortably covers "select all" on a large
// library; the client chunks anything bigger. Keeps the $in queries sane.
const MAX_IDS = 10000;

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const session = await requireAuth(request);
    userId = session.user.id;
    await enforceStorageAccess(userId);

    let body: { bucketId?: unknown; ids?: unknown };
    try {
      body = await request.json();
    } catch {
      statusCode = 400;
      errorMessage = "Invalid JSON";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const bucketId = body.bucketId;
    const rawIds = body.ids;

    if (typeof bucketId !== "string" || !bucketId) {
      statusCode = 400;
      errorMessage = "bucketId is required";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    if (!Array.isArray(rawIds)) {
      statusCode = 400;
      errorMessage = "ids must be an array";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const ids = Array.from(
      new Set(rawIds.filter((x): x is string => typeof x === "string" && !!x)),
    );

    if (ids.length === 0) {
      return NextResponse.json({
        success: true,
        deletedCount: 0,
        removedCount: 0,
      });
    }
    if (ids.length > MAX_IDS) {
      statusCode = 400;
      errorMessage = `Too many ids (max ${MAX_IDS} per request)`;
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      $or: [{ userId }, { userId: "system" }],
    })
      .select("_id")
      .lean<{ _id: unknown }>();

    if (!bucket) {
      statusCode = 404;
      errorMessage = "Bucket not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    // Ownership-scoped: only the caller's own, not-already-binned objects in
    // this bucket. Unknown / foreign / already-gone ids drop out here.
    const objects = await StorageObject.find({
      _id: { $in: ids },
      bucketId,
      userId,
      deletedAt: { $exists: false },
    })
      .select("_id key")
      .lean<{ _id: Types.ObjectId; key: string }[]>();

    if (objects.length === 0) {
      return NextResponse.json({
        success: true,
        deletedCount: 0,
        removedCount: 0,
      });
    }

    const objectIds = objects.map((o) => o._id);

    // Cascade to sidecars (subtitles / extra audio tracks) of every object.
    const sidecars = await StorageObject.find({
      parentObjectId: { $in: objectIds },
      userId,
      deletedAt: { $exists: false },
    })
      .select("_id")
      .lean<{ _id: Types.ObjectId }[]>();

    const allDocIds = [...objectIds, ...sidecars.map((s) => s._id)];
    const now = new Date();

    // Soft-delete every record in one write. Blobs + metering untouched.
    await StorageObject.updateMany(
      { _id: { $in: allDocIds } },
      { $set: { deletedAt: now } },
    );

    // Revoke shares for everything binned.
    await ShareLink.deleteMany({ objectId: { $in: allDocIds } });
    await DirectShare.deleteMany({ objectId: { $in: allDocIds } });

    // Drop them from any albums + album shares.
    await removeObjectsFromAlbums(userId, allDocIds);

    const keys = objects.map((object) => object.key);
    const affectedPrefixes = Array.from(
      new Set(keys.map(parentPrefixForKey)),
    );
    await publishSyncEvent({
      userId,
      type: "FILE_DELETED",
      payload: {
        bucketId,
        objectIds: objectIds.map(String),
        keys,
        affectedPrefixes,
      },
      invalidatePrefixes: affectedPrefixes,
      invalidateRecent: true,
    });

    return NextResponse.json({
      success: true,
      deletedCount: objects.length,
      removedCount: allDocIds.length,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      statusCode = 401;
      errorMessage = "Unauthorized";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    if (error instanceof Error && error.name === "SubscriptionRequired") {
      statusCode = 402;
      errorMessage = "Active subscription required";
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

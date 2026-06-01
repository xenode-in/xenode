/**
 * POST /api/objects/restore
 *
 * Pull objects back out of the Bin. Unsets `deletedAt` on the selected objects
 * and their sidecars so they reappear in normal listings.
 *
 * Body:  { bucketId: string, ids: string[] }
 * Reply: { success: true, restoredCount }
 *
 * No B2 work and no metering change: the blobs were never removed on soft-delete
 * and binned items kept counting against quota, so restoring is purely a flag
 * flip. (Shares revoked at bin time are NOT restored — re-share if needed.)
 *
 * Only the caller's own, currently-binned objects in the bucket are affected.
 */

import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { requireAuth } from "@/lib/auth/session";
import { logRequest } from "@/lib/logRequest";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { enforceStorageAccess } from "@/lib/subscriptions/service";

export const dynamic = "force-dynamic";

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
    if (typeof bucketId !== "string" || !bucketId) {
      statusCode = 400;
      errorMessage = "bucketId is required";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    if (!Array.isArray(body.ids)) {
      statusCode = 400;
      errorMessage = "ids must be an array";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const ids = Array.from(
      new Set(body.ids.filter((x): x is string => typeof x === "string" && !!x)),
    );
    if (ids.length === 0) {
      return NextResponse.json({ success: true, restoredCount: 0 });
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

    const objects = await StorageObject.find({
      _id: { $in: ids },
      bucketId,
      userId,
      deletedAt: { $exists: true },
    })
      .select("_id")
      .lean<{ _id: Types.ObjectId }[]>();

    if (objects.length === 0) {
      return NextResponse.json({ success: true, restoredCount: 0 });
    }

    const objectIds = objects.map((o) => o._id);

    // Restore sidecars alongside their parents.
    const sidecars = await StorageObject.find({
      parentObjectId: { $in: objectIds },
      userId,
      deletedAt: { $exists: true },
    })
      .select("_id")
      .lean<{ _id: Types.ObjectId }[]>();

    const allDocIds = [...objectIds, ...sidecars.map((s) => s._id)];

    await StorageObject.updateMany(
      { _id: { $in: allDocIds } },
      { $unset: { deletedAt: "" } },
    );

    return NextResponse.json({
      success: true,
      restoredCount: objects.length,
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

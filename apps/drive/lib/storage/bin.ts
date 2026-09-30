import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { BIN_BATCH_LIMIT, cleanupDriveBinObject, queueDriveBinPurge, restoreDriveBin, getDatabase } from "@xenode/database";
import { type AccessContext, bucketOwnershipClause } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import { deleteObjects } from "@/lib/b2/objects";
import { revisionError } from "./revision-upload";
import { publishSyncEvent } from "@/lib/realtime/publish";

export async function handleBinMutation(request: NextRequest, ctx: AccessContext, operation: "restore" | "purge", inferBucket = false) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      (body.bucketId !== undefined && (typeof body.bucketId !== "string" || !/^[0-9a-f]{24}$/iu.test(body.bucketId)))) {
      return NextResponse.json({ error: "Invalid Bin request" }, { status: 400 });
    }
    if (!inferBucket && !body.bucketId) return NextResponse.json({ error: "bucketId is required" }, { status: 400 });
    const all = operation === "purge" && body.all === true;
    if (!all && (!Array.isArray(body.ids) || body.ids.some((id: unknown) => typeof id !== "string" || !/^[0-9a-f]{24}$/iu.test(id)))) {
      return NextResponse.json({ error: "Valid ids are required" }, { status: 400 });
    }
    const ids = all ? undefined : [...new Set<string>(body.ids)].map((id) => new Types.ObjectId(id));
    if (ids && ids.length > BIN_BATCH_LIMIT) return NextResponse.json({ error: "Select at most 100 Bin objects" }, { status: 400 });
    await dbConnect();
    const bucket = await Bucket.findOne({ ...(body.bucketId ? { _id: body.bucketId } : {}), ...bucketOwnershipClause(ctx) });
    if (!bucket) return NextResponse.json({ error: "Bucket is unavailable" }, { status: 404 });
    const input = { spaceId: ctx.spaceId, bucketId: bucket._id, ids, all };
    if (operation === "restore") {
      const result = await restoreDriveBin(input);
      await publishSyncEvent({
        userId: ctx.accountId, spaceId: ctx.spaceId, type: "TRASH_UPDATED",
        payload: { bucketId: String(bucket._id), objectIds: ids?.map(String) ?? [] },
        invalidateRecent: true, invalidateStorage: true,
      }).catch((error) => console.error("Bin restore notification failed:", error));
      return NextResponse.json({ success: true, ...result });
    }
    const queued = await queueDriveBinPurge(input);
    let purgedCount = 0, failed = 0;
    for (const objectId of queued) {
      const result = await cleanupDriveBinObject({ objectId, deleteBlobs: deleteObjects });
      if (result === "deleted") purgedCount++;
      if (result === "retry") failed++;
    }
    return NextResponse.json({
      success: !failed, purgedCount, queuedCount: queued.length, pendingCount: queued.length - purgedCount,
      ...(failed ? { error: "Some deletions are pending; cleanup will retry", code: "purge_retry_pending" } : {}),
      hasMore: all && !!await getDatabase().collection("storageobjects").findOne({
        productId: "drive", spaceId: ctx.spaceId, bucketId: bucket._id, deletedAt: { $type: "date" }, purgeState: { $exists: false },
      }, { projection: { _id: 1 } }),
    }, { status: failed ? 500 : purgedCount < queued.length ? 202 : 200 });
  } catch (error) { return revisionError(error); }
}

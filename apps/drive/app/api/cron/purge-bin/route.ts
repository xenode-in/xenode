import { NextRequest, NextResponse } from "next/server";
import { BIN_BATCH_LIMIT, cleanupDriveBinObject, connectDatabase, getDatabase, queueDriveBinPurge } from "@xenode/database";
import { deleteObjects } from "@/lib/b2/objects";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await connectDatabase();
    const now = new Date(), cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const objects = getDatabase().collection("storageobjects");
    const candidates = await objects.find({ productId: "drive", "versions.pendingDeletion": { $ne: true }, $or: [
      { deletedAt: { $lte: cutoff }, purgeState: { $exists: false } },
      { purgeState: "pending", purgeAfter: { $lte: now }, $and: [
        { $or: [{ purgeLeaseExpiresAt: { $exists: false } }, { purgeLeaseExpiresAt: { $lte: now } }] },
        { $or: [{ purgeNextAttemptAt: { $exists: false } }, { purgeNextAttemptAt: { $lte: now } }] },
      ] },
    ] }).sort({ deletedAt: 1, _id: 1 }).limit(BIN_BATCH_LIMIT).toArray();
    let purgedCount = 0, failed = 0, blocked = 0, skipped = 0;
    for (const object of candidates) {
      try {
        if (!object.purgeState) await queueDriveBinPurge({ spaceId: object.spaceId, bucketId: object.bucketId, ids: [object._id], cutoff });
        const result = await cleanupDriveBinObject({ objectId: object._id, deleteBlobs: deleteObjects });
        if (result === "deleted") purgedCount++; else if (result === "retry") failed++; else if (result === "blocked") blocked++; else skipped++;
      } catch { failed++; }
    }
    return NextResponse.json({ scanned: candidates.length, purgedCount, failed, blocked, skipped }, { status: failed ? 500 : 200 });
  } catch { return NextResponse.json({ error: "Bin cleanup failed" }, { status: 500 }); }
}

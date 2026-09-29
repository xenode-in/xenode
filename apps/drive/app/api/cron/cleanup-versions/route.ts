import { NextRequest, NextResponse } from "next/server";
import { cleanupDriveVersion, connectDatabase, getDatabase } from "@xenode/database";
import { deleteObjects } from "@/lib/b2/objects";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await connectDatabase();
    const now = new Date();
    const entries = await getDatabase().collection("storageobjects").aggregate([
      { $match: { productId: "drive", "versions.pendingDeletion": true } },
      { $unwind: "$versions" },
      { $match: { "versions.pendingDeletion": true, "versions.deletionState": { $ne: "blocked" }, $and: [
        { $or: [{ "versions.cleanupLeaseExpiresAt": { $exists: false } }, { "versions.cleanupLeaseExpiresAt": { $lte: now } }] },
        { $or: [{ "versions.cleanupNextAttemptAt": { $exists: false } }, { "versions.cleanupNextAttemptAt": { $lte: now } }] },
      ] } },
      { $sort: { "versions.createdAt": 1, _id: 1 } }, { $limit: 100 },
      { $project: { _id: 1, spaceId: 1, versionId: "$versions.versionId" } },
    ]).toArray();
    const counts = { scanned: entries.length, deleted: 0, blocked: 0, skipped: 0, retry: 0 };
    for (const entry of entries) {
      const result = await cleanupDriveVersion({ objectId: entry._id, spaceId: entry.spaceId, versionId: entry.versionId, deleteBlobs: deleteObjects });
      counts[result]++;
    }
    return NextResponse.json(counts, { status: counts.retry ? 500 : 200 });
  } catch { return NextResponse.json({ error: "Version cleanup failed" }, { status: 500 }); }
}

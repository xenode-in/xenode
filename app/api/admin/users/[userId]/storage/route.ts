import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import Usage from "@/models/Usage";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await params;
  await dbConnect();

  const [buckets, usage] = await Promise.all([
    Bucket.find({ userId }).lean(),
    Usage.findOne({ userId }).lean(),
  ]);

  const bucketIds = buckets.map((b) => b._id);

  // Per-bucket object stats
  const objectStats = await StorageObject.aggregate([
    { $match: { bucketId: { $in: bucketIds } } },
    {
      $group: {
        _id: "$bucketId",
        objectCount: { $sum: 1 },
        totalBytes: { $sum: "$size" },
        encryptedCount: { $sum: { $cond: ["$isEncrypted", 1, 0] } },
        contentTypes: { $addToSet: "$contentType" },
      },
    },
  ]);

  const statsMap = new Map(
    objectStats.map((s) => [s._id.toString(), s])
  );

  const bucketsWithStats = buckets.map((b) => {
    const stat = statsMap.get(b._id.toString());
    return {
      id: b._id.toString(),
      name: b.name,
      region: b.region,
      createdAt: b.createdAt,
      objectCount: stat?.objectCount ?? b.objectCount,
      totalBytes: stat?.totalBytes ?? b.totalSizeBytes,
      encryptedCount: stat?.encryptedCount ?? 0,
      contentTypes: stat?.contentTypes ?? [],
    };
  });

  return NextResponse.json({
    userId,
    usage: {
      totalStorageBytes: usage?.totalStorageBytes ?? 0,
      totalEgressBytes: usage?.totalEgressBytes ?? 0,
      totalObjects: usage?.totalObjects ?? 0,
      totalBuckets: usage?.totalBuckets ?? 0,
      storageLimitBytes: usage?.storageLimitBytes ?? 1099511627776,
      egressLimitBytes: usage?.egressLimitBytes ?? 536870912000,
    },
    buckets: bucketsWithStats,
  });
}

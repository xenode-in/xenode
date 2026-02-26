import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();

  const [usageStats, totalBuckets, totalObjects] = await Promise.all([
    Usage.aggregate([
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          totalStorageBytes: { $sum: "$totalStorageBytes" },
          totalEgressBytes: { $sum: "$totalEgressBytes" },
          totalObjects: { $sum: "$totalObjects" },
          totalBuckets: { $sum: "$totalBuckets" },
        },
      },
    ]),
    Bucket.countDocuments(),
    StorageObject.countDocuments(),
  ]);

  const stats = usageStats[0] ?? {
    totalUsers: 0,
    totalStorageBytes: 0,
    totalEgressBytes: 0,
    totalObjects: 0,
    totalBuckets: 0,
  };

  return NextResponse.json({
    totalUsers: stats.totalUsers,
    totalStorageBytes: stats.totalStorageBytes,
    totalEgressBytes: stats.totalEgressBytes,
    totalObjects: stats.totalObjects,
    totalBuckets: stats.totalBuckets,
    // Cross-check with actual counts
    actualBuckets: totalBuckets,
    actualObjects: totalObjects,
  });
}

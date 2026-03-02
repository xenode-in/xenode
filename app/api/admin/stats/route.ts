import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import mongoose from "mongoose";

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();

  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date(todayStart);
  monthStart.setMonth(monthStart.getMonth() - 1);

  const db = mongoose.connection.db;
  if (!db) {
    return NextResponse.json({ error: "DB not connected" }, { status: 500 });
  }

  const userCollection = db.collection("user");

  const [
    usageStats,
    totalBuckets,
    totalObjects,
    newUsersToday,
    newUsersThisWeek,
    newUsersThisMonth,
    planStats,
  ] = await Promise.all([
    Usage.aggregate([
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          totalStorageBytes: { $sum: "$totalStorageBytes" },
          totalEgressBytes: { $sum: "$totalEgressBytes" },
          totalObjects: { $sum: "$totalObjects" },
          totalBuckets: { $sum: "$totalBuckets" },
          totalUploads: { $sum: "$uploadCount" },
          totalDownloads: { $sum: "$downloadCount" },
        },
      },
    ]),
    Bucket.countDocuments(),
    StorageObject.countDocuments(),
    userCollection.countDocuments({ createdAt: { $gte: todayStart } }),
    userCollection.countDocuments({ createdAt: { $gte: weekStart } }),
    userCollection.countDocuments({ createdAt: { $gte: monthStart } }),
    Usage.aggregate([{ $group: { _id: "$plan", count: { $sum: 1 } } }]),
  ]);

  const stats = usageStats[0] ?? {
    totalUsers: 0,
    totalStorageBytes: 0,
    totalEgressBytes: 0,
    totalObjects: 0,
    totalBuckets: 0,
    totalUploads: 0,
    totalDownloads: 0,
  };

  const planBreakdown = Object.fromEntries(
    planStats.map((p: { _id: string; count: number }) => [
      p._id ?? "free",
      p.count,
    ])
  );

  return NextResponse.json({
    totalUsers: stats.totalUsers,
    totalStorageBytes: stats.totalStorageBytes,
    totalEgressBytes: stats.totalEgressBytes,
    totalObjects: stats.totalObjects,
    totalBuckets: stats.totalBuckets,
    totalUploads: stats.totalUploads,
    totalDownloads: stats.totalDownloads,
    actualBuckets: totalBuckets,
    actualObjects: totalObjects,
    growth: {
      newUsersToday,
      newUsersThisWeek,
      newUsersThisMonth,
    },
    plans: planBreakdown,
  });
}

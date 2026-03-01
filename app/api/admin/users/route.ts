import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import ShareLink from "@/models/ShareLink";
import mongoose from "mongoose";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20")));
  const skip = (page - 1) * limit;
  const search = searchParams.get("search") ?? "";
  const planFilter = searchParams.get("plan") ?? "";

  const db = mongoose.connection.db;
  if (!db) {
    return NextResponse.json({ error: "DB not connected" }, { status: 500 });
  }

  const userCollection = db.collection("user");

  const matchQuery: Record<string, unknown> = search
    ? {
        $or: [
          { email: { $regex: search, $options: "i" } },
          { name: { $regex: search, $options: "i" } },
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    userCollection.find(matchQuery).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    userCollection.countDocuments(matchQuery),
  ]);

  const userIds = users.map((u) => u.id ?? u._id?.toString());

  // Optionally filter by plan at the usage level
  const usageFilter: Record<string, unknown> = { userId: { $in: userIds } };
  if (planFilter) usageFilter.plan = planFilter;

  const [usageRecords, shareCounts] = await Promise.all([
    Usage.find(usageFilter).lean(),
    ShareLink.aggregate([
      { $match: { createdBy: { $in: userIds } } },
      {
        $group: {
          _id: "$createdBy",
          total: { $sum: 1 },
          totalDownloads: { $sum: "$downloadCount" },
        },
      },
    ]),
  ]);

  const usageMap = new Map(usageRecords.map((u) => [u.userId, u]));
  const shareMap = new Map(shareCounts.map((s: { _id: string; total: number; totalDownloads: number }) => [s._id, s]));

  const enriched = users.map((u) => {
    const uid = u.id ?? u._id?.toString();
    const usage = usageMap.get(uid);
    const share = shareMap.get(uid);
    return {
      id: uid,
      name: u.name,
      email: u.email,
      image: u.image,
      createdAt: u.createdAt,
      emailVerified: u.emailVerified,
      plan: usage?.plan ?? "free",
      planExpiresAt: usage?.planExpiresAt ?? null,
      lastActiveAt: usage?.lastActiveAt ?? null,
      storage: {
        totalStorageBytes: usage?.totalStorageBytes ?? 0,
        totalEgressBytes: usage?.totalEgressBytes ?? 0,
        totalObjects: usage?.totalObjects ?? 0,
        totalBuckets: usage?.totalBuckets ?? 0,
        storageLimitBytes: usage?.storageLimitBytes ?? 1099511627776,
        egressLimitBytes: usage?.egressLimitBytes ?? 536870912000,
        uploadCount: usage?.uploadCount ?? 0,
        downloadCount: usage?.downloadCount ?? 0,
      },
      shareLinks: {
        total: share?.total ?? 0,
        totalDownloads: share?.totalDownloads ?? 0,
      },
    };
  });

  return NextResponse.json({
    users: enriched,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

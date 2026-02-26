import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import mongoose from "mongoose";

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

  // Get user info from better-auth's "user" collection
  const db = mongoose.connection.db;
  if (!db) {
    return NextResponse.json({ error: "DB not connected" }, { status: 500 });
  }

  const userCollection = db.collection("user");

  const matchQuery = search
    ? {
        $or: [
          { email: { $regex: search, $options: "i" } },
          { name: { $regex: search, $options: "i" } },
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    userCollection
      .find(matchQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    userCollection.countDocuments(matchQuery),
  ]);

  // Enrich with usage data
  const userIds = users.map((u) => u.id ?? u._id?.toString());
  const usageRecords = await Usage.find({ userId: { $in: userIds } }).lean();
  const usageMap = new Map(
    usageRecords.map((u) => [u.userId, u])
  );

  const enriched = users.map((u) => {
    const uid = u.id ?? u._id?.toString();
    const usage = usageMap.get(uid);
    return {
      id: uid,
      name: u.name,
      email: u.email,
      image: u.image,
      createdAt: u.createdAt,
      emailVerified: u.emailVerified,
      storage: {
        totalStorageBytes: usage?.totalStorageBytes ?? 0,
        totalEgressBytes: usage?.totalEgressBytes ?? 0,
        totalObjects: usage?.totalObjects ?? 0,
        totalBuckets: usage?.totalBuckets ?? 0,
        storageLimitBytes: usage?.storageLimitBytes ?? 1099511627776,
        egressLimitBytes: usage?.egressLimitBytes ?? 536870912000,
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

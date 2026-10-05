import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import ShareLink from "@/models/ShareLink";
import DirectShare from "@/models/DirectShare";
import ApiKey from "@/models/ApiKey";
import mongoose from "mongoose";
import {
  beginPersonalRetirement,
  deleteAccountIdentity,
  DriveUploadCommitError,
} from "@xenode/database";

type RouteContext = { params: Promise<{ userId: string }> };

/** GET /api/admin/users/[userId] — full user detail with all metrics */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const session = await getAdminSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await params;
  await dbConnect();

  const db = mongoose.connection.db;
  if (!db)
    return NextResponse.json({ error: "DB not connected" }, { status: 500 });

  const [user, usage, shareStats, apiKeyCount] = await Promise.all([
    db.collection("user").findOne({
      $or: [
        { id: userId },
        ...(mongoose.Types.ObjectId.isValid(userId)
          ? [{ _id: new mongoose.Types.ObjectId(userId) }]
          : []),
      ],
    }),
    Usage.findOne({ userId }).lean(),
    ShareLink.aggregate([
      { $match: { createdBy: userId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          totalDownloads: { $sum: "$downloadCount" },
          active: {
            $sum: { $cond: [{ $eq: ["$isRevoked", false] }, 1, 0] },
          },
        },
      },
    ]),
    ApiKey.countDocuments({ userId }),
  ]);

  if (!user)
    return NextResponse.json({ error: "User not found" }, { status: 404 });

  const share = shareStats[0] ?? { total: 0, totalDownloads: 0, active: 0 };

  return NextResponse.json({
    user: {
      id: userId,
      name: user.name,
      email: user.email,
      image: user.image,
      createdAt: user.createdAt,
      emailVerified: user.emailVerified,
      onboarded: user.onboarded ?? false,
    },
    usage: {
      plan: usage?.plan ?? "free",
      planActivatedAt: usage?.planActivatedAt ?? null,
      planExpiresAt: usage?.planExpiresAt ?? null,
      totalStorageBytes: usage?.totalStorageBytes ?? 0,
      totalEgressBytes: usage?.totalEgressBytes ?? 0,
      totalObjects: usage?.totalObjects ?? 0,
      totalBuckets: usage?.totalBuckets ?? 0,
      storageLimitBytes: usage?.storageLimitBytes ?? 1099511627776,
      egressLimitBytes: usage?.egressLimitBytes ?? 536870912000,
      uploadCount: usage?.uploadCount ?? 0,
      downloadCount: usage?.downloadCount ?? 0,
      lastActiveAt: usage?.lastActiveAt ?? null,
    },
    shareLinks: share,
    apiKeyCount,
  });
}

/** PATCH /api/admin/users/[userId] — update plan / storage limits */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const session = await getAdminSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await params;
  const body = await req.json();

  const update: Record<string, unknown> = {};

  if (body.plan !== undefined) {
    if (!["free", "basic", "pro", "plus", "max", "enterprise"].includes(body.plan))
      return NextResponse.json(
        { error: "Invalid plan value" },
        { status: 400 },
      );
    update.plan = body.plan;
    update.planActivatedAt = body.plan !== "free" ? new Date() : null;
  }

  if (body.storageLimitBytes !== undefined) {
    const val = Number(body.storageLimitBytes);
    if (isNaN(val) || val < 0)
      return NextResponse.json(
        { error: "Invalid storageLimitBytes" },
        { status: 400 },
      );
    update.storageLimitBytes = val;
  }

  if (body.egressLimitBytes !== undefined) {
    const val = Number(body.egressLimitBytes);
    if (isNaN(val) || val < 0)
      return NextResponse.json(
        { error: "Invalid egressLimitBytes" },
        { status: 400 },
      );
    update.egressLimitBytes = val;
  }

  if (body.planExpiresAt !== undefined) {
    update.planExpiresAt = body.planExpiresAt
      ? new Date(body.planExpiresAt)
      : null;
  }

  if (Object.keys(update).length === 0)
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 },
    );

  await dbConnect();

  const updated = await Usage.findOneAndUpdate(
    { userId },
    { $set: update },
    { upsert: true, new: true },
  );

  return NextResponse.json({ usage: updated });
}

/**
 * DELETE /api/admin/users/[userId] — delete an account. Super admin only.
 *
 * Access and identity end now; Drive files go through the purge pipeline
 * (ciphertext deleted, bytes released) and the quota record and Space follow
 * once storage is empty (cron `purge-orgs`). Refused while the account
 * belongs to an organization or another product still stores its data.
 */
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const session = await getAdminSession();
  if (!session || session.role !== "super_admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = await params;
  await dbConnect();

  try {
    await beginPersonalRetirement({ accountId: userId });
  } catch (error) {
    if (error instanceof DriveUploadCommitError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
  await deleteAccountIdentity(userId);
  await Promise.all([
    ShareLink.deleteMany({ createdBy: userId }),
    DirectShare.deleteMany({ createdBy: userId }),
    ApiKey.deleteMany({ userId }),
  ]);

  return NextResponse.json({ success: true, status: "retiring" }, { status: 202 });
}

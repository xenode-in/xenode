import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";

/**
 * Fields returned in listing responses.
 *
 * Deliberately excludes sensitive crypto fields (encryptedDEK, iv) and the
 * internal b2FileId — callers that need those should hit GET /api/objects/[id].
 */
const LIST_PROJECTION =
  "key size contentType thumbnail tags position createdAt isEncrypted encryptedName";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/**
 * GET /api/objects?bucketId=xxx&page=1&limit=50 - List objects in a bucket
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const { searchParams } = request.nextUrl;
    const bucketId = searchParams.get("bucketId");
    if (!bucketId) {
      return NextResponse.json(
        { error: "Bucket ID is required" },
        { status: 400 },
      );
    }

    // Pagination params — clamp to [1, MAX_PAGE_SIZE]
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(searchParams.get("limit") || String(DEFAULT_PAGE_SIZE), 10)),
    );
    const skip = (page - 1) * limit;

    await dbConnect();

    // Verify bucket ownership — only fetch the two fields we actually use
    const bucket = await Bucket.findOne({
      _id: bucketId,
      $or: [{ userId }, { userId: "system" }],
    })
      .select("_id userId")
      .lean();

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    // Build query — replace $regex with a range query for system-bucket prefix
    // scans so MongoDB can satisfy both the filter and the createdAt sort with
    // the compound index { key:1, bucketId:1 } without an in-memory sort step.
    const query: Record<string, unknown> = { bucketId };
    if (bucket.userId === "system") {
      const prefix = `users/${userId}/`;
      query.key = { $gte: prefix, $lt: prefix + "\uffff" };
    }

    // Fire count + page fetch in parallel — saves one full RTT vs sequential
    const [total, objects] = await Promise.all([
      StorageObject.countDocuments(query),
      StorageObject.find(query)
        .select(LIST_PROJECTION)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return NextResponse.json({
      objects,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

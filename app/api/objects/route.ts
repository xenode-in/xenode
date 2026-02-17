import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";

/**
 * GET /api/objects?bucketId=xxx - List objects in a bucket
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const bucketId = request.nextUrl.searchParams.get("bucketId");
    if (!bucketId) {
      return NextResponse.json(
        { error: "Bucket ID is required" },
        { status: 400 },
      );
    }

    await dbConnect();

    // Verify bucket ownership
    // Verify bucket ownership (User or System)
    const bucket = await Bucket.findOne({
      _id: bucketId,
      $or: [{ userId }, { userId: "system" }],
    }).lean();

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    // If system bucket, restrict to user's folder
    const query: any = { bucketId };
    if (bucket.userId === "system") {
      query.key = { $regex: `^users/${userId}/` };
    }

    const objects = await StorageObject.find(query)
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ objects });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { deleteB2Bucket } from "@/lib/b2/buckets";
import { deleteObject as deleteB2Object } from "@/lib/b2/objects";
import { decrementBucketCount, decrementStorage } from "@/lib/metering/usage";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/buckets/[id] - Get bucket details
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;
    const { id } = await params;

    await dbConnect();

    const bucket = await Bucket.findOne({ _id: id, userId }).lean();
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    return NextResponse.json({ bucket });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/buckets/[id] - Delete a bucket and all its objects
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;
    const { id } = await params;

    await dbConnect();

    const bucket = await Bucket.findOne({ _id: id, userId });
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    // Delete all objects in the bucket from B2 first
    const objects = await StorageObject.find({ bucketId: bucket._id });
    const b2BucketName = `xn-${userId.slice(0, 8)}-${bucket.name}`;

    for (const obj of objects) {
      try {
        await deleteB2Object(b2BucketName, obj.key);
      } catch {
        // Continue even if B2 delete fails — object may already be gone
      }
    }

    // Calculate total size for usage update
    const totalSize = objects.reduce((sum, obj) => sum + obj.size, 0);

    // Delete objects from MongoDB
    await StorageObject.deleteMany({ bucketId: bucket._id });

    // Delete bucket from B2
    try {
      await deleteB2Bucket(b2BucketName);
    } catch {
      // B2 bucket might already be deleted
    }

    // Delete bucket from MongoDB
    await Bucket.findByIdAndDelete(bucket._id);

    // Update usage
    await decrementBucketCount(userId);
    if (totalSize > 0) {
      await decrementStorage(userId, totalSize);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

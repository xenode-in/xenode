import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import {
  deleteObject as deleteB2Object,
  getDownloadUrl,
} from "@/lib/b2/objects";
import { decrementStorage, updateBucketStats } from "@/lib/metering/usage";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/objects/[id] - Get download URL for an object
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;
    const { id } = await params;

    await dbConnect();

    const object = await StorageObject.findOne({ _id: id, userId });
    if (!object) {
      return NextResponse.json({ error: "Object not found" }, { status: 404 });
    }

    const bucket = await Bucket.findOne({ _id: object.bucketId, userId });
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    const b2BucketName = `xn-${userId.slice(0, 8)}-${bucket.name}`;
    const url = await getDownloadUrl(b2BucketName, object.key);

    return NextResponse.json({ url });
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
 * DELETE /api/objects/[id] - Delete an object
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;
    const { id } = await params;

    await dbConnect();

    const object = await StorageObject.findOne({ _id: id, userId });
    if (!object) {
      return NextResponse.json({ error: "Object not found" }, { status: 404 });
    }

    // Get bucket for B2 bucket name
    const bucket = await Bucket.findOne({ _id: object.bucketId, userId });
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    const b2BucketName = `xn-${userId.slice(0, 8)}-${bucket.name}`;

    // Delete from B2
    try {
      await deleteB2Object(b2BucketName, object.key);
    } catch {
      // Continue even if B2 delete fails
    }

    // Delete from MongoDB
    await StorageObject.findByIdAndDelete(object._id);

    // Update usage
    await decrementStorage(userId, object.size);
    await updateBucketStats(bucket._id.toString(), -1, -object.size);

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

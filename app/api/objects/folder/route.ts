import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { uploadObject, deleteObject } from "@/lib/b2/objects";
import { decrementStorage, updateBucketStats } from "@/lib/metering/usage";
import ShareLink from "@/models/ShareLink";

export const dynamic = "force-dynamic";

/**
 * POST /api/objects/folder - Create a new folder (empty object with trailing slash)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;
    const body = await request.json();
    const { bucketId, name, prefix = "" } = body;

    if (!bucketId || !name) {
      return NextResponse.json(
        { error: "Bucket ID and folder name are required" },
        { status: 400 },
      );
    }

    // Validate folder name (simple alphanumeric + dashes/underscores)
    if (!/^[a-zA-Z0-9\-_ ]+$/.test(name)) {
      return NextResponse.json(
        { error: "Folder name contains invalid characters" },
        { status: 400 },
      );
    }

    await dbConnect();

    // Verify bucket ownership
    // Verify bucket ownership
    const bucket = await Bucket.findOne({
      _id: bucketId,
      $or: [{ userId }, { userId: "system" }],
    });

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    // Enforce prefix for system bucket
    if (bucket.userId === "system") {
      if (!prefix.startsWith(`users/${userId}/`)) {
        return NextResponse.json(
          { error: "Access denied to this folder" },
          { status: 403 },
        );
      }
    }

    // Construct full key with trailing slash
    const fullKey = `${prefix}${name}/`;
    const b2BucketName = bucket.b2BucketId;

    // Check if folder already exists
    const existing = await StorageObject.findOne({
      bucketId,
      key: fullKey,
    });

    if (existing) {
      return NextResponse.json(
        { error: "Folder already exists" },
        { status: 409 },
      );
    }

    // Upload 0-byte object to B2
    const uploadResult = await uploadObject(
      b2BucketName,
      fullKey,
      Buffer.from(""), // Empty body
      "application/x-directory",
      0,
    );

    // Create database record
    const folder = await StorageObject.create({
      bucketId: bucket._id,
      userId,
      key: fullKey,
      size: 0,
      contentType: "application/x-directory",
      b2FileId: uploadResult.b2FileId,
    });

    // We don't increment storage usage for folders (0 bytes)
    // But we might want to increment object count?
    // Let's increment object count for now
    await Bucket.updateOne({ _id: bucket._id }, { $inc: { objectCount: 1 } });

    return NextResponse.json({ folder }, { status: 201 });
  } catch (error: unknown) {
    console.error("Create folder error:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Failed to create folder" },
      { status: 500 },
    );
  }
}
/**
 * DELETE /api/objects/folder - Recursively delete a folder and its contents
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;
    const body = await request.json();
    const { bucketId, prefix } = body;

    if (!bucketId || !prefix) {
      return NextResponse.json(
        { error: "Bucket ID and prefix are required" },
        { status: 400 },
      );
    }

    await dbConnect();

    // Verify bucket ownership
    const bucket = await Bucket.findOne({
      _id: bucketId,
      $or: [{ userId }, { userId: "system" }],
    });

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    // Enforce prefix for system bucket
    if (bucket.userId === "system") {
      if (!prefix.startsWith(`users/${userId}/`)) {
        return NextResponse.json(
          { error: "Access denied to this folder" },
          { status: 403 },
        );
      }
    }

    // Find all objects with this prefix
    // Escape regex characters
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const objects = await StorageObject.find({
      bucketId,
      key: { $regex: `^${escapedPrefix}` },
    });

    const b2BucketName = bucket.b2BucketId;
    let deletedCount = 0;
    const deletedObjectIds: string[] = [];

    // Delete each object
    for (const obj of objects) {
      // Delete from B2
      try {
        await deleteObject(b2BucketName, obj.key);
      } catch (e) {
        console.error(`Failed to delete B2 object ${obj.key}:`, e);
      }

      // Delete from MongoDB
      await StorageObject.findByIdAndDelete(obj._id);
      deletedObjectIds.push(obj._id.toString());

      // Update usage
      if (obj.size > 0) {
        await decrementStorage(userId, obj.size);
        await updateBucketStats(bucket._id.toString(), -1, -obj.size);
      } else {
        // Just decrement count for 0-byte objects (folders)
        await updateBucketStats(bucket._id.toString(), -1, 0);
      }
      deletedCount++;
    }

    // Cascade delete all share links for deleted objects
    if (deletedObjectIds.length > 0) {
      await ShareLink.deleteMany({ objectId: { $in: deletedObjectIds } });
    }

    return NextResponse.json({ success: true, deletedCount });
  } catch (error: unknown) {
    console.error("Delete folder error:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Failed to delete folder" },
      { status: 500 },
    );
  }
}

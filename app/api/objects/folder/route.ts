import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { uploadObject, deleteObject } from "@/lib/b2/objects";
import { decrementStorage, updateBucketStats } from "@/lib/metering/usage";
import ShareLink from "@/models/ShareLink";

export const dynamic = "force-dynamic";

/** POST /api/objects/folder - Create a new folder */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const userId = session.user.id;
    const body = await request.json();
    const { bucketId, name, encryptedDisplayName, prefix = "" } = body;

    if (!bucketId || !name) {
      return NextResponse.json({ error: "Bucket ID and folder name are required" }, { status: 400 });
    }

    if (!/^[a-zA-Z0-9\-_ ]+$/.test(name)) {
      return NextResponse.json({ error: "Folder name contains invalid characters" }, { status: 400 });
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      $or: [{ userId }, { userId: "system" }],
    });

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    if (bucket.userId === "system" && !prefix.startsWith(`users/${userId}/`)) {
      return NextResponse.json({ error: "Access denied to this folder" }, { status: 403 });
    }

    const fullKey = `${prefix}${name}/`;
    const b2BucketName = bucket.b2BucketId;

    const existing = await StorageObject.findOne({ bucketId, key: fullKey });
    if (existing) {
      return NextResponse.json({ error: "Folder already exists" }, { status: 409 });
    }

    const uploadResult = await uploadObject(b2BucketName, fullKey, Buffer.from(""), "application/x-directory", 0);

    const folder = await StorageObject.create({
      bucketId: bucket._id,
      userId,
      key: fullKey,
      size: 0,
      contentType: "application/x-directory",
      encryptedDisplayName,
      b2FileId: uploadResult.b2FileId,
    });

    await Bucket.updateOne({ _id: bucket._id }, { $inc: { objectCount: 1 } });

    return NextResponse.json({ folder }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to create folder" }, { status: 500 });
  }
}

/** DELETE /api/objects/folder - Recursively delete a folder and its contents */
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const userId = session.user.id;
    const body = await request.json();
    const { bucketId, prefix } = body;

    if (!bucketId || !prefix) {
      return NextResponse.json({ error: "Bucket ID and prefix are required" }, { status: 400 });
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      $or: [{ userId }, { userId: "system" }],
    });

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    if (bucket.userId === "system" && !prefix.startsWith(`users/${userId}/`)) {
      return NextResponse.json({ error: "Access denied to this folder" }, { status: 403 });
    }

    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const objects = await StorageObject.find({ bucketId, key: { $regex: `^${escapedPrefix}` } });

    const b2BucketName = bucket.b2BucketId;
    let deletedCount = 0;
    const deletedObjectIds: string[] = [];

    for (const obj of objects) {
      try {
        await deleteObject(b2BucketName, obj.key);
        // Delete thumbnail if it's stored in B2
        if (obj.thumbnail && obj.thumbnail.startsWith("users/")) {
          await deleteObject(b2BucketName, obj.thumbnail);
        }
      } catch (e) {
        console.error(`Failed to delete B2 object ${obj.key}:`, e);
      }
      await StorageObject.findByIdAndDelete(obj._id);
      deletedObjectIds.push(obj._id.toString());
      if (obj.size > 0) {
        await decrementStorage(userId, obj.size);
        await updateBucketStats(bucket._id.toString(), -1, -obj.size);
      } else {
        await updateBucketStats(bucket._id.toString(), -1, 0);
      }
      deletedCount++;
    }

    if (deletedObjectIds.length > 0) {
      await ShareLink.deleteMany({ objectId: { $in: deletedObjectIds } });
    }

    return NextResponse.json({ success: true, deletedCount });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to delete folder" }, { status: 500 });
  }
}

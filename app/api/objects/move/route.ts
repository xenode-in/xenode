import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { copyObject, deleteObject as deleteB2Object } from "@/lib/b2/objects";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const userId = session.user.id;
    const { bucketId, sourceKeys, destinationPrefix } = await request.json();

    if (!bucketId || !sourceKeys || !Array.isArray(sourceKeys) || destinationPrefix === undefined) {
      return NextResponse.json({ error: "Invalid request parameters" }, { status: 400 });
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      $or: [{ userId }, { userId: "system" }],
    });

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    if (bucket.userId === "system" && !destinationPrefix.startsWith(`users/${userId}/`)) {
      return NextResponse.json({ error: "Access denied to destination" }, { status: 403 });
    }

    const b2BucketName = bucket.b2BucketId;
    const movedObjects = [];
    const errors = [];

    for (const sourceKey of sourceKeys) {
      if (bucket.userId === "system" && !sourceKey.startsWith(`users/${userId}/`)) {
        errors.push({ key: sourceKey, error: "Access denied to source" });
        continue;
      }

      const isFolder = sourceKey.endsWith("/");
      const sourceName = isFolder
        ? sourceKey.split("/").filter(Boolean).pop()
        : sourceKey.split("/").pop();

      if (isFolder) {
        const objectsToMove = await StorageObject.find({
          bucketId: bucket._id,
          userId,
          key: { $regex: `^${sourceKey}` },
        });

        for (const obj of objectsToMove) {
          const relativePath = obj.key.slice(sourceKey.length);
          const newKey = `${destinationPrefix}${sourceName}/${relativePath}`;
          try {
            await copyObject(b2BucketName, obj.key, b2BucketName, newKey);
            const newObj = await StorageObject.create({
              ...obj.toObject(),
              _id: undefined,
              key: newKey,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            await deleteB2Object(b2BucketName, obj.key);
            await StorageObject.findByIdAndDelete(obj._id);
            movedObjects.push(newObj);
          } catch (err) {
            errors.push({ key: obj.key, error: "Failed to move" });
          }
        }
      } else {
        const newKey = `${destinationPrefix}${sourceName}`;
        const obj = await StorageObject.findOne({ bucketId: bucket._id, userId, key: sourceKey });
        if (obj) {
          try {
            await copyObject(b2BucketName, sourceKey, b2BucketName, newKey);
            const newObj = await StorageObject.create({
              ...obj.toObject(),
              _id: undefined,
              key: newKey,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            await deleteB2Object(b2BucketName, sourceKey);
            await StorageObject.findByIdAndDelete(obj._id);
            movedObjects.push(newObj);
          } catch (err) {
            errors.push({ key: sourceKey, error: "Failed to move" });
          }
        }
      }
    }

    return NextResponse.json({
      moved: movedObjects.length,
      movedObjects,
      errors,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to move objects";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

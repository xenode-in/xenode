import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { copyObject, deleteObject as deleteB2Object } from "@/lib/b2/objects";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;
    const { bucketId, sourceKeys, destinationPrefix } = await request.json();

    if (
      !bucketId ||
      !sourceKeys ||
      !Array.isArray(sourceKeys) ||
      destinationPrefix === undefined
    ) {
      return NextResponse.json(
        { error: "Invalid request parameters" },
        { status: 400 },
      );
    }

    await dbConnect();

    // Verify bucket
    const bucket = await Bucket.findOne({
      _id: bucketId,
      $or: [{ userId }, { userId: "system" }],
    });

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    // Security: Ensure destination is allowed
    if (
      bucket.userId === "system" &&
      !destinationPrefix.startsWith(`users/${userId}/`)
    ) {
      return NextResponse.json(
        { error: "Access denied to destination" },
        { status: 403 },
      );
    }

    const b2BucketName = bucket.b2BucketId;
    const movedObjects = [];
    const errors = [];

    for (const sourceKey of sourceKeys) {
      // Security: Ensure source is allowed
      if (
        bucket.userId === "system" &&
        !sourceKey.startsWith(`users/${userId}/`)
      ) {
        errors.push({ key: sourceKey, error: "Access denied to source" });
        continue;
      }

      // Determine if file or folder
      const isFolder = sourceKey.endsWith("/");
      const sourceName = isFolder
        ? sourceKey.split("/").filter(Boolean).pop()
        : sourceKey.split("/").pop();

      // Correct logic for destination key
      // If moving "folder/foo/" to "bar/", new key is "bar/foo/"
      // If moving "file.txt" to "bar/", new key is "bar/file.txt"

      if (isFolder) {
        // Find all objects with this prefix
        const objectsToMove = await StorageObject.find({
          bucketId: bucket._id,
          userId, // Ensure ownership
          key: { $regex: `^${sourceKey}` },
        });

        for (const obj of objectsToMove) {
          // calculate relative path from source folder's parent
          // e.g. source: users/1/A/, dest: users/1/B/
          // obj: users/1/A/file.txt
          // relative: A/file.txt (from users/1/)
          // new: users/1/B/A/file.txt

          // Wait, logic:
          // sourceKey: users/1/A/
          // destinationPrefix: users/1/B/
          // We want A/ inside B/.
          // So replace `users/1/A/` with `users/1/B/A/` ? NO.
          // sourceKey usually includes the folder name "A/".
          // logic: remove parent of A.
          // parent of A is `users/1/`.

          // Simpler:
          // get the part of the key after the *parent* of sourceKey.
          // sourceKeyParent = sourceKey.substring(0, sourceKey.lastIndexOf("/", sourceKey.length - 2) + 1);
          // But simplified:
          // We are moving "A" to "B". "A" becomes child of "B".
          // So `prefix` matches `sourceKey`.
          // relativePath = obj.key.slice(sourceKey.length);
          // newKey = destinationPrefix + sourceName + "/" + relativePath;

          // Example:
          // sourceKey = "users/1/foo/" (folder foo)
          // destinationPrefix = "users/1/bar/" (folder bar)
          // obj.key = "users/1/foo/sub/img.jpg"
          // sourceName = "foo"
          // relativePath = "sub/img.jpg" (slice "users/1/foo/".length)
          // newKey = "users/1/bar/" + "foo/" + "sub/img.jpg"
          // = "users/1/bar/foo/sub/img.jpg" -> CORRECT.

          const relativePath = obj.key.slice(sourceKey.length);
          const newKey = `${destinationPrefix}${sourceName}/${relativePath}`;

          try {
            // Copy S3
            await copyObject(b2BucketName, obj.key, b2BucketName, newKey);

            // Create new DB record
            const newObj = await StorageObject.create({
              ...obj.toObject(),
              _id: undefined, // New ID
              key: newKey,
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            // Delete old
            await deleteB2Object(b2BucketName, obj.key);
            await StorageObject.findByIdAndDelete(obj._id);

            movedObjects.push(newObj);
          } catch (err) {
            console.error("Failed to move object", obj.key, err);
            errors.push({ key: obj.key, error: "Failed to move" });
          }
        }
      } else {
        // File
        const newKey = `${destinationPrefix}${sourceName}`;

        // Find object
        const obj = await StorageObject.findOne({
          bucketId: bucket._id,
          userId,
          key: sourceKey,
        });

        if (obj) {
          try {
            await copyObject(b2BucketName, sourceKey, b2BucketName, newKey);
            const newObj = await StorageObject.create({
              ...obj.toObject(),
              _id: undefined, // New ID
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

    return NextResponse.json({ moved: movedObjects.length, errors });
  } catch (error: any) {
    if (error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error.message || "Failed to move objects" },
      { status: 500 },
    );
  }
}

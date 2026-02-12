import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { uploadObject } from "@/lib/b2/objects";
import { incrementStorage, updateBucketStats } from "@/lib/metering/usage";

/**
 * POST /api/objects/upload - Upload a file
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const bucketId = formData.get("bucketId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!bucketId) {
      return NextResponse.json(
        { error: "Bucket ID is required" },
        { status: 400 },
      );
    }

    await dbConnect();

    // Verify bucket ownership
    const bucket = await Bucket.findOne({ _id: bucketId, userId });
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    const key = file.name;
    const buffer = Buffer.from(await file.arrayBuffer());
    const size = buffer.length;
    const contentType = file.type || "application/octet-stream";
    const b2BucketName = `xn-${userId.slice(0, 8)}-${bucket.name}`;

    // Upload to B2
    let uploadResult: { etag: string; b2FileId: string };
    try {
      uploadResult = await uploadObject(
        b2BucketName,
        key,
        buffer,
        contentType,
        size,
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to upload file";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    // Check if object already exists (overwrite scenario)
    const existingObject = await StorageObject.findOne({
      bucketId: bucket._id,
      key,
    });
    if (existingObject) {
      const sizeDiff = size - existingObject.size;
      existingObject.size = size;
      existingObject.contentType = contentType;
      existingObject.b2FileId = uploadResult.b2FileId;
      await existingObject.save();

      if (sizeDiff !== 0) {
        await incrementStorage(userId, sizeDiff);
        await updateBucketStats(bucket._id.toString(), 0, sizeDiff);
      }

      return NextResponse.json({ object: existingObject }, { status: 200 });
    }

    // Create object record
    const storageObject = await StorageObject.create({
      bucketId: bucket._id,
      userId,
      key,
      size,
      contentType,
      b2FileId: uploadResult.b2FileId,
    });

    // Update usage
    await incrementStorage(userId, size);
    await updateBucketStats(bucket._id.toString(), 1, size);

    return NextResponse.json({ object: storageObject }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

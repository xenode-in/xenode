import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { incrementStorage, updateBucketStats } from "@/lib/metering/usage";
import { getS3Client } from "@/lib/b2/client";
import { HeadObjectCommand } from "@aws-sdk/client-s3";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const {
      objectKey,
      bucketId,
      size,
      contentType,
      thumbnail,
      encryptedDEK,
      iv,
      isEncrypted,
      encryptedName,
      chunkSize,
      chunkCount,
      chunkIvs,
    } = await request.json();

    if (!objectKey || !bucketId || !size) {
      return NextResponse.json(
        { error: "Missing required fields" },
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

    // Retrieve B2 File ID (VersionId) from S3
    let b2FileId = "";
    try {
      const command = new HeadObjectCommand({
        Bucket: bucket.b2BucketId,
        Key: objectKey,
      });
      const s3Response = await getS3Client().send(command);
      // B2 S3 Compat uses VersionId as the B2 File ID
      b2FileId = s3Response.VersionId || `${bucket.b2BucketId}/${objectKey}`;
    } catch (err) {
      console.error("Failed to head object from B2:", err);
      return NextResponse.json(
        { error: "File not found in storage" },
        { status: 404 },
      );
    }

    // Check if object already exists (overwrite)
    const existingObject = await StorageObject.findOne({
      bucketId,
      key: objectKey,
    });

    if (existingObject) {
      const sizeDiff = size - existingObject.size;
      existingObject.size = size;
      existingObject.contentType = contentType;
      existingObject.b2FileId = b2FileId; // Update File ID
      if (thumbnail) existingObject.thumbnail = thumbnail;
      if (isEncrypted) {
        existingObject.isEncrypted = true;
        if (encryptedDEK) existingObject.encryptedDEK = encryptedDEK;
        if (iv) existingObject.iv = iv;
        if (encryptedName) existingObject.encryptedName = encryptedName;
        if (chunkSize) existingObject.chunkSize = chunkSize;
        if (chunkCount) existingObject.chunkCount = chunkCount;
        if (chunkIvs) existingObject.chunkIvs = chunkIvs;
      }
      await existingObject.save();

      if (sizeDiff !== 0) {
        await incrementStorage(userId, sizeDiff);
        await updateBucketStats(bucketId, 0, sizeDiff);
      }

      return NextResponse.json({ object: existingObject });
    }

    // Create new object record
    const storageObject = await StorageObject.create({
      bucketId,
      userId,
      key: objectKey,
      size,
      contentType,
      b2FileId,
      thumbnail,
      isEncrypted: isEncrypted ?? false,
      encryptedDEK: encryptedDEK ?? undefined,
      iv: iv ?? undefined,
      encryptedName: encryptedName ?? undefined,
      chunkSize: chunkSize ?? undefined,
      chunkCount: chunkCount ?? undefined,
      chunkIvs: chunkIvs ?? undefined,
    });

    // Update usage
    await incrementStorage(userId, size);
    await updateBucketStats(bucketId, 1, size);

    return NextResponse.json({ object: storageObject }, { status: 201 });
  } catch (error) {
    console.error("Upload completion error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

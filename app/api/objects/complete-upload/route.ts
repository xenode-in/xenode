import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { incrementStorage, updateBucketStats } from "@/lib/metering/usage";
import { getS3Client } from "@/lib/b2/client";
import { HeadObjectCommand } from "@aws-sdk/client-s3";

export const dynamic = "force-dynamic";

function getMediaCategory(contentType: string): string {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.includes("pdf") || contentType.includes("document"))
    return "document";
  return "other";
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const userId = session.user.id;

    const {
      objectKey,
      bucketId,
      size,
      contentType,
      originalContentType,
      encryptedContentType,
      thumbnail,
      encryptedDEK,
      iv,
      isEncrypted,
      encryptedName,
      chunkSize,
      chunkCount,
      chunkIvs,
      isChunked,
      chunks,
    } = await request.json();

    if (!objectKey || !bucketId || !size) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    if (!objectKey.startsWith(`users/${userId}/`)) {
      return NextResponse.json(
        { error: "Invalid object key" },
        { status: 403 },
      );
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      $or: [{ userId }, { userId: "system" }],
    });

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    const mediaCategory = getMediaCategory(originalContentType ?? contentType);

    let b2FileId = "";
    if (isChunked) {
      if (!chunks || chunks.length !== chunkCount) {
        return NextResponse.json(
          { error: "Invalid chunks provided" },
          { status: 400 },
        );
      }

      let totalSize = 0;
      for (const chunk of chunks) {
        try {
          const command = new HeadObjectCommand({
            Bucket: bucket.b2BucketId,
            Key: chunk.key,
          });
          await getS3Client().send(command);
          totalSize += chunk.size;
        } catch (err) {
          console.error(`Failed to head chunk ${chunk.key} from B2:`, err);
          return NextResponse.json(
            { error: `Chunk ${chunk.index} not found in storage` },
            { status: 404 },
          );
        }
      }

      if (totalSize !== size) {
        return NextResponse.json({ error: "Size mismatch" }, { status: 400 });
      }

      // No single b2FileId for chunked uploads
      b2FileId = `multipart-${objectKey}`;
    } else {
      try {
        const command = new HeadObjectCommand({
          Bucket: bucket.b2BucketId,
          Key: objectKey,
        });
        const s3Response = await getS3Client().send(command);
        b2FileId = s3Response.VersionId || `${bucket.b2BucketId}/${objectKey}`;
      } catch (err) {
        console.error("Failed to head object from B2:", err);
        return NextResponse.json(
          { error: "File not found in storage" },
          { status: 404 },
        );
      }
    }

    const existingObject = await StorageObject.findOne({
      bucketId,
      key: objectKey,
    });

    if (existingObject) {
      const sizeDiff = size - existingObject.size;
      existingObject.size = size;
      existingObject.contentType = contentType;
      existingObject.mediaCategory = mediaCategory as any;
      existingObject.b2FileId = b2FileId;
      if (thumbnail) existingObject.thumbnail = thumbnail;
      if (isEncrypted) {
        existingObject.isEncrypted = true;
        if (encryptedContentType)
          existingObject.encryptedContentType = encryptedContentType;
        if (encryptedDEK) existingObject.encryptedDEK = encryptedDEK;
        if (iv) existingObject.iv = iv;
        if (encryptedName) existingObject.encryptedName = encryptedName;
        if (chunkSize) existingObject.chunkSize = chunkSize;
        if (chunkCount) existingObject.chunkCount = chunkCount;
        if (chunkIvs) existingObject.chunkIvs = chunkIvs;
        if (isChunked && chunks) existingObject.chunks = chunks;
      }
      await existingObject.save();
      if (sizeDiff !== 0) {
        await incrementStorage(userId, sizeDiff);
        await updateBucketStats(bucketId, 0, sizeDiff);
      }
      return NextResponse.json({ object: existingObject });
    }

    const storageObject = await StorageObject.create({
      bucketId,
      userId,
      key: objectKey,
      size,
      contentType: "application/octet-stream",
      encryptedContentType: encryptedContentType ?? undefined,
      mediaCategory,
      b2FileId,
      thumbnail,
      isEncrypted: isEncrypted ?? false,
      encryptedDEK: encryptedDEK ?? undefined,
      iv: iv ?? undefined,
      encryptedName: encryptedName ?? undefined,
      chunkSize: chunkSize ?? undefined,
      chunkCount: chunkCount ?? undefined,
      chunkIvs: chunkIvs ?? undefined,
      chunks: isChunked && chunks ? chunks : undefined,
    });

    await incrementStorage(userId, size, {
      contentType: originalContentType ?? contentType,
      bucketId,
      isEncrypted,
    });
    await updateBucketStats(bucketId, 1, size);

    return NextResponse.json({ object: storageObject }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "QUOTA_EXCEEDED") {
      return NextResponse.json(
        { error: "Storage quota exceeded" },
        { status: 402 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

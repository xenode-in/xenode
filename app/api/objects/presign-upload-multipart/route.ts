import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "crypto";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const userId = session.user.id;

    const B2_ENDPOINT = process.env.B2_ENDPOINT || "https://s3.us-west-004.backblazeb2.com";
    const B2_REGION = process.env.B2_REGION || "us-west-004";
    const B2_KEY_ID = process.env.B2_KEY_ID;
    const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY;

    if (!B2_KEY_ID || !B2_APPLICATION_KEY) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    const keyId = B2_KEY_ID.trim();
    const appKey = B2_APPLICATION_KEY.trim();
    const { fileSize, fileType, bucketId, chunkCount, prefix, fileName } = await request.json();

    if (!bucketId) {
      return NextResponse.json({ error: "bucketId required" }, { status: 400 });
    }
    if (!chunkCount || chunkCount <= 0) {
      return NextResponse.json({ error: "chunkCount required" }, { status: 400 });
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      $or: [{ userId }, { userId: "system" }],
    });

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    const usage = await Usage.findOne({ userId });
    if (usage) {
      if (usage.plan !== "free" && usage.planExpiresAt && usage.planExpiresAt < new Date()) {
        await Usage.updateOne(
          { userId },
          { $set: { plan: "free", storageLimitBytes: FREE_TIER_LIMIT_BYTES, planPriceINR: 0 } },
        );
        usage.storageLimitBytes = FREE_TIER_LIMIT_BYTES;
      }

      if (usage.storageLimitBytes !== null) {
        const fileSizeBytes = typeof fileSize === "number" ? fileSize : 0;
        const projectedUsage = (usage.totalStorageBytes || 0) + fileSizeBytes;
        if (projectedUsage > usage.storageLimitBytes) {
          return NextResponse.json(
            {
              error: "storage_quota_exceeded",
              message: "You have reached your storage limit. Please upgrade your plan or delete files.",
              currentBytes: usage.totalStorageBytes,
              limitBytes: usage.storageLimitBytes,
            },
            { status: 402 },
          );
        }
      }
    }

    const s3Client = new S3Client({
      endpoint: B2_ENDPOINT,
      region: B2_REGION,
      credentials: { accessKeyId: keyId, secretAccessKey: appKey },
      forcePathStyle: true,
    });

    // Chunk calculation
    const chunkSize = 2 * 1024 * 1024; // 2MB
    
    const basePrefix = prefix || `users/${userId}/`;
    
    // Fallback to random hex if no filename is provided
    let safeFileName = fileName || randomBytes(16).toString("hex");
    
    // Sanitize filename to prevent directory traversal
    safeFileName = safeFileName.replace(/[\/\\]/g, "_");
    
    const logicalKey = `${basePrefix}${safeFileName}`;
    
    const urls = [];
    for (let i = 0; i < chunkCount; i++) {
      const chunkKey = `${logicalKey}-chunk-${i}`;
      const command = new PutObjectCommand({
        Bucket: bucket.b2BucketId,
        Key: chunkKey,
        ContentType: fileType || "application/octet-stream",
      });

      const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      urls.push({
        index: i,
        key: chunkKey,
        url: presignedUrl,
      });
    }

    return NextResponse.json({
      fileId: logicalKey,
      chunkSize,
      chunkCount,
      urls,
      bucketId: bucket._id.toString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate multipart upload URLs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

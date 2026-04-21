import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "crypto";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";
import { enforceStorageAccess } from "@/lib/subscriptions/service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const userId = session.user.id;
    await enforceStorageAccess(userId);

    const S3_ENDPOINT =
      process.env.S3_ENDPOINT || "https://s3.us-west-004.backblazeb2.com";
    const S3_REGION = process.env.S3_REGION || "us-west-004";
    const S3_KEY_ID = process.env.S3_KEY_ID;
    const S3_APPLICATION_KEY = process.env.S3_APPLICATION_KEY;

    if (!S3_KEY_ID || !S3_APPLICATION_KEY) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

    const keyId = S3_KEY_ID.trim();
    const appKey = S3_APPLICATION_KEY.trim();
    const { fileSize, fileType, bucketId, prefix, fileName } =
      await request.json();

    if (!bucketId) {
      return NextResponse.json({ error: "bucketId required" }, { status: 400 });
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
      if (
        usage.plan !== "free" &&
        usage.planExpiresAt &&
        usage.planExpiresAt < new Date()
      ) {
        await Usage.updateOne(
          { userId },
          {
            $set: {
              plan: "free",
              storageLimitBytes: FREE_TIER_LIMIT_BYTES,
              planPriceINR: 0,
            },
          },
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
              message:
                "You have reached your storage limit. Please upgrade your plan or delete files.",
              currentBytes: usage.totalStorageBytes,
              limitBytes: usage.storageLimitBytes,
            },
            { status: 402 },
          );
        }
      }
    }

    const basePrefix = prefix || `users/${userId}/`;

    // Fallback to random hex if no filename is provided
    let safeFileName = fileName || randomBytes(16).toString("hex");

    // Sanitize filename to prevent directory traversal
    safeFileName = safeFileName.replace(/[\/\\]/g, "_");

    const opaqueKey = `${basePrefix}${safeFileName}`;

    const s3Client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      credentials: { accessKeyId: keyId, secretAccessKey: appKey },
      forcePathStyle: true,
    });

    const command = new PutObjectCommand({
      Bucket: bucket.b2BucketId,
      Key: opaqueKey,
      ContentType: fileType || "application/octet-stream",
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600,
    });

    return NextResponse.json({
      uploadUrl: presignedUrl,
      objectKey: opaqueKey,
      bucketId: bucket._id.toString(),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "SubscriptionRequired") {
      return NextResponse.json(
        { error: "Active subscription required" },
        { status: 402 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Failed to generate upload URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

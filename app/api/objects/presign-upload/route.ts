import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "crypto";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import Usage from "@/models/Usage";

export const dynamic = "force-dynamic";

const FREE_TIER_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const B2_ENDPOINT =
      process.env.B2_ENDPOINT || "https://s3.us-west-004.backblazeb2.com";
    const B2_REGION = process.env.B2_REGION || "us-west-004";
    const B2_KEY_ID = process.env.B2_KEY_ID;
    const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY;

    if (!B2_KEY_ID || !B2_APPLICATION_KEY) {
      console.error("Missing B2 credentials");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

    const keyId = B2_KEY_ID.trim();
    const appKey = B2_APPLICATION_KEY.trim();

    const { fileSize, fileType, bucketId } = await request.json();

    // fileName is no longer used for the storage key — only for display (stays client-side)
    if (!bucketId) {
      return NextResponse.json(
        { error: "bucketId required" },
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
      // System bucket access validated — opaque key will be scoped to userId
    }

    // CVE-5 + GAP-1: Enforce quota and plan expiry BEFORE issuing presigned URL
    const usage = await Usage.findOne({ userId });
    if (usage) {
      if (
        usage.plan !== "free" &&
        usage.planExpiresAt &&
        usage.planExpiresAt < new Date()
      ) {
        await Usage.updateOne(
          { userId },
          { $set: { plan: "free", storageLimitBytes: FREE_TIER_BYTES, planPriceINR: 0 } },
        );
        usage.storageLimitBytes = FREE_TIER_BYTES;
      }

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

    /**
     * GAP-4: Opaque object key — NEVER embed original filename in the B2 storage path.
     * The original filename ONLY lives in StorageObject.encryptedName (AES-GCM encrypted).
     * This prevents filename leakage via B2 bucket listings or MongoDB key field.
     *
     * Format: users/{userId}/{randomHex32}
     * Example: users/64abc.../a3f9c21d8e4b70f2c1e5d9a8b6c4f0e7
     */
    const opaqueKey = `users/${userId}/${randomBytes(16).toString("hex")}`;

    const s3Client = new S3Client({
      endpoint: B2_ENDPOINT,
      region: B2_REGION,
      credentials: {
        accessKeyId: keyId,
        secretAccessKey: appKey,
      },
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
      /**
       * Return opaqueKey to the client so it can pass it to complete-upload.
       * Client must NOT derive this from the filename.
       */
      objectKey: opaqueKey,
      bucketId: bucket._id.toString(),
    });
  } catch (error) {
    console.error("Presigned URL generation error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to generate upload URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

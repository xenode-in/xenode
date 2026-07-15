import { NextRequest, NextResponse } from "next/server";
import {
  bucketOwnershipClause,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "crypto";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";
import { enforceStorageAccess } from "@/lib/subscriptions/service";
import { orgObjectKeyPrefix, teamObjectKeyPrefix } from "@/lib/orgs/storage";
import { recordUploadSession, attachToUploadSession } from "@/lib/uploads/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    const userId = ctx.userId;
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
    const { fileSize, fileType, bucketId, prefix, fileName, sessionFileId } =
      await request.json();

    if (!bucketId) {
      return NextResponse.json({ error: "bucketId required" }, { status: 400 });
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      ...bucketOwnershipClause(ctx),
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

    const allowedPrefix =
      ctx.spaceType === "organization"
        ? orgObjectKeyPrefix(ctx.organizationId!)
        : ctx.spaceType === "team"
          ? teamObjectKeyPrefix(ctx.organizationId!, ctx.teamId!)
        : `users/${userId}/`;
    const basePrefix = typeof prefix === "string" && prefix ? prefix : allowedPrefix;
    if (!basePrefix.startsWith(allowedPrefix)) {
      return NextResponse.json(
        { error: "Access denied to this folder" },
        { status: 403 },
      );
    }

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

    // Ledger the in-flight upload so the cleanup-orphans cron can reclaim its
    // blobs if it never finishes. When `sessionFileId` names a parent upload
    // (optimized preview / thumbnail of a main file), attach this blob's key to
    // that parent's session so it is protected by the parent's completion and
    // reclaimed with it — but only if the parent session actually exists and is
    // owned by this user. Otherwise this key owns a fresh session and
    // pre-registers its own derived `-thumb` key.
    let sessionId: string | undefined;
    if (typeof sessionFileId === "string" && sessionFileId) {
      sessionId = await attachToUploadSession({
        userId,
        bucketId: bucket._id,
        parentFileId: sessionFileId,
        key: opaqueKey,
      });
    }
    if (!sessionId) {
      sessionId = await recordUploadSession({
        userId,
        bucketId: bucket._id,
        fileId: opaqueKey,
        keys: [opaqueKey, `${opaqueKey}-thumb`],
      });
    }

    return NextResponse.json({
      uploadUrl: presignedUrl,
      objectKey: opaqueKey,
      bucketId: bucket._id.toString(),
      sessionId,
    });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
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

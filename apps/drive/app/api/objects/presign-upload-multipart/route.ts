import { NextRequest, NextResponse } from "next/server";
import {
  bucketOwnershipClause,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "crypto";
import { getS3Client } from "@/lib/b2/client";
import { activeStorageBucketName } from "@/lib/storage/region-context";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";
import { enforceStorageAccess } from "@/lib/subscriptions/service";
import { orgObjectKeyPrefix, teamObjectKeyPrefix } from "@/lib/orgs/storage";
import { recordUploadSession } from "@/lib/uploads/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    const userId = ctx.userId;
    await enforceStorageAccess(userId);

    const {
      fileSize,
      fileType,
      bucketId,
      chunkCount,
      prefix,
      fileName,
      chunkSize: clientChunkSize,
    } = await request.json();

    if (!bucketId) {
      return NextResponse.json({ error: "bucketId required" }, { status: 400 });
    }
    if (!chunkCount || chunkCount <= 0) {
      return NextResponse.json(
        { error: "chunkCount required" },
        { status: 400 },
      );
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

    // Region-aware client + bucket (bound in requireAccessContext).
    const s3Client = getS3Client();
    const regionBucket = activeStorageBucketName();

    // Accept client-provided adaptive chunk size (validated 2 MB – 64 MB)
    const MIN_CHUNK = 2 * 1024 * 1024;
    const MAX_CHUNK = 64 * 1024 * 1024;
    const chunkSize = clientChunkSize
      ? Math.max(MIN_CHUNK, Math.min(MAX_CHUNK, Number(clientChunkSize)))
      : MIN_CHUNK;

    const allowedPrefix =
      ctx.spaceType === "organization"
        ? orgObjectKeyPrefix(ctx.organizationId!)
        : ctx.spaceType === "team"
          ? teamObjectKeyPrefix(ctx.organizationId!, ctx.teamId!)
          : `users/${userId}/`;
    const basePrefix = typeof prefix === "string" && prefix ? prefix : allowedPrefix;
    if (!basePrefix.startsWith(allowedPrefix)) {
      return NextResponse.json(
        { error: "Access denied to destination" },
        { status: 403 },
      );
    }

    // Fallback to random hex if no filename is provided
    let safeFileName = fileName || randomBytes(16).toString("hex");

    // Sanitize filename to prevent directory traversal
    safeFileName = safeFileName.replace(/[\/\\]/g, "_");

    const logicalKey = `${basePrefix}${safeFileName}`;

    const urls = [];
    const chunkKeys: string[] = [];
    for (let i = 0; i < chunkCount; i++) {
      const chunkKey = `${logicalKey}-chunk-${i}`;
      chunkKeys.push(chunkKey);
      const command = new PutObjectCommand({
        Bucket: regionBucket,
        Key: chunkKey,
        ContentType: fileType || "application/octet-stream",
      });

      const presignedUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 3600,
      });
      urls.push({
        index: i,
        key: chunkKey,
        url: presignedUrl,
      });
    }

    // Ledger every B2 key this chunked upload will write (main logical key,
    // each chunk, and the derived thumbnail) so the cleanup-orphans cron can
    // reclaim them if the upload is abandoned. Re-presigning the same fileName
    // on resume refreshes the same session and reuses the same chunk keys.
    const sessionId = await recordUploadSession({
      userId,
      bucketId: bucket._id,
      fileId: logicalKey,
      keys: [logicalKey, ...chunkKeys, `${logicalKey}-thumb`],
    });

    return NextResponse.json({
      fileId: logicalKey,
      chunkSize,
      chunkCount,
      urls,
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
      error instanceof Error
        ? error.message
        : "Failed to generate multipart upload URLs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

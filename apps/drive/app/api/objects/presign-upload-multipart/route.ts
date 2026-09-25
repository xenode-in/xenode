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
import { reserveUploadSession, findPendingUploadSession } from "@/lib/uploads/session";
import { findReferencedStorageObjectKeys } from "@xenode/database";

export const dynamic = "force-dynamic";
const MAX_PRESIGNED_CHUNKS = 4096;
const MIN_CHUNK = 2 * 1024 * 1024;
const MAX_CHUNK = 64 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request, "write");
    const userId = ctx.userId;
    await enforceStorageAccess(userId);

    const {
      fileSize,
      fileType,
      bucketId,
      chunkCount,
      prefix,
      chunkSize: clientChunkSize,
      sessionId: resumeSessionId,
    } = await request.json();

    if (!bucketId) {
      return NextResponse.json({ error: "bucketId required" }, { status: 400 });
    }
    if (
      !Number.isSafeInteger(chunkCount) ||
      chunkCount < 1 ||
      chunkCount > MAX_PRESIGNED_CHUNKS
    ) {
      return NextResponse.json(
        { error: "Valid chunkCount required" },
        { status: 400 },
      );
    }
    if (!Number.isSafeInteger(fileSize) || fileSize < 1) {
      return NextResponse.json({ error: "Valid fileSize required" }, { status: 400 });
    }
    if (resumeSessionId !== undefined && typeof resumeSessionId !== "string") {
      return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
    }
    if (
      clientChunkSize !== undefined &&
      (!Number.isSafeInteger(clientChunkSize) ||
        clientChunkSize < MIN_CHUNK ||
        clientChunkSize > MAX_CHUNK)
    ) {
      return NextResponse.json({ error: "Invalid chunkSize" }, { status: 400 });
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

    // Region-aware client + bucket from the caller's region.
    const s3Client = getS3Client(ctx.region);
    const regionBucket = activeStorageBucketName(ctx.region);

    const chunkSize = clientChunkSize ?? MIN_CHUNK;

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

    const existing = resumeSessionId
      ? await findPendingUploadSession({
          userId,
          bucketId: bucket._id,
          sessionId: resumeSessionId,
        })
      : null;
    if (resumeSessionId && !existing) {
      return NextResponse.json(
        { error: "Upload reservation is missing or no longer pending", code: "upload_reservation_conflict" },
        { status: 409 },
      );
    }
    const logicalKey = existing?.fileId ?? `${basePrefix}${randomBytes(16).toString("hex")}`;
    if (!logicalKey.startsWith(allowedPrefix)) {
      return NextResponse.json({ error: "Upload Space mismatch" }, { status: 403 });
    }
    const chunkKeys = Array.from(
      { length: chunkCount },
      (_, index) => `${logicalKey}-chunk-${index}`,
    );
    if (
      existing &&
      existing.keys.filter((key) => key.startsWith(`${logicalKey}-chunk-`)).length !== chunkCount
    ) {
      return NextResponse.json({ error: "Chunk layout changed" }, { status: 409 });
    }
    const referenced = await findReferencedStorageObjectKeys({
      bucketId: bucket._id,
      keys: [logicalKey, ...chunkKeys, `${logicalKey}-thumb`],
    });
    if (referenced.size) {
      return NextResponse.json(
        { error: "Upload key is already in use", code: "upload_key_conflict" },
        { status: 409 },
      );
    }

    const sessionId = await reserveUploadSession({
      userId,
      bucketId: bucket._id,
      fileId: logicalKey,
      keys: [logicalKey, ...chunkKeys, `${logicalKey}-thumb`],
      sessionId: resumeSessionId,
    });
    if (!sessionId) {
      return NextResponse.json(
        { error: "Upload reservation is missing or no longer pending", code: "upload_reservation_conflict" },
        { status: 409 },
      );
    }

    const urls = [];
    for (let i = 0; i < chunkCount; i++) {
      const chunkKey = chunkKeys[i];
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

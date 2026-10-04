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
import { spaceStorageRoot } from "@/lib/storage/folders";
import {
  reserveUploadSession,
  attachToUploadSession,
  findPendingUploadSession,
} from "@/lib/uploads/session";
import { assertDriveUploadHeadroom, DriveUploadCommitError, findReferencedStorageObjectKeys } from "@xenode/database";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request, "write");
    const userId = ctx.userId;

    const {
      fileSize, fileType, bucketId,
      sessionId: resumeSessionId, parentSessionId, variant,
    } = await request.json();

    if (!bucketId) {
      return NextResponse.json({ error: "bucketId required" }, { status: 400 });
    }
    if (!Number.isSafeInteger(fileSize) || fileSize < 1) {
      return NextResponse.json({ error: "Valid fileSize required" }, { status: 400 });
    }
    if (
      (resumeSessionId !== undefined && typeof resumeSessionId !== "string") ||
      (parentSessionId !== undefined && typeof parentSessionId !== "string") ||
      (resumeSessionId && parentSessionId) ||
      (variant !== undefined && variant !== "thumbnail" && variant !== "optimized") ||
      (Boolean(parentSessionId) !== Boolean(variant))
    ) {
      return NextResponse.json({ error: "Invalid upload reservation request" }, { status: 400 });
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      ...bucketOwnershipClause(ctx),
    });

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    await assertDriveUploadHeadroom({
      spaceId: ctx.spaceId, accountId: ctx.accountId, additionalBytes: fileSize,
    });

    // Physical keys live directly under the Space root; folder placement is
    // metadata chosen at completion, never part of the key.
    const allowedPrefix = spaceStorageRoot(ctx);
    const basePrefix = allowedPrefix;

    const existing = parentSessionId || resumeSessionId
      ? await findPendingUploadSession({
          userId,
          spaceId: ctx.spaceId,
          bucketId: bucket._id,
          sessionId: parentSessionId || resumeSessionId,
        })
      : null;
    if ((parentSessionId || resumeSessionId) && !existing) {
      return NextResponse.json(
        { error: "Upload reservation is missing or no longer pending", code: "upload_reservation_conflict" },
        { status: 409 },
      );
    }
    const opaqueKey = parentSessionId
      ? `${existing!.fileId}-${variant === "thumbnail" ? "thumb" : "optimized"}`
      : existing?.fileId ?? `${basePrefix}${randomBytes(16).toString("hex")}`;
    if (!opaqueKey.startsWith(allowedPrefix)) {
      return NextResponse.json({ error: "Upload Space mismatch" }, { status: 403 });
    }
    const referenced = await findReferencedStorageObjectKeys({
      bucketId: bucket._id,
      keys: [opaqueKey, `${opaqueKey}-thumb`],
    });
    if (referenced.size) {
      return NextResponse.json(
        { error: "Upload key is already in use", code: "upload_key_conflict" },
        { status: 409 },
      );
    }

    // Reserve before signing: a duplicate or expired ledger cannot receive a
    // fresh PUT URL, and a secondary key needs its parent's reservation token.
    const sessionId = parentSessionId
      ? await attachToUploadSession({
          userId,
          spaceId: ctx.spaceId,
          bucketId: bucket._id,
          parentFileId: existing!.fileId,
          parentSessionId,
          key: opaqueKey,
        })
      : await reserveUploadSession({
          userId,
          spaceId: ctx.spaceId,
          bucketId: bucket._id,
          fileId: opaqueKey,
          keys: [opaqueKey, `${opaqueKey}-thumb`],
          sessionId: resumeSessionId,
        });
    if (!sessionId) {
      return NextResponse.json(
        { error: "Upload reservation is missing or no longer pending", code: "upload_reservation_conflict" },
        { status: 409 },
      );
    }

    // Region-aware: the client + physical bucket are resolved from the caller's
    // storage region (bound in requireAccessContext). Asia is unchanged.
    const command = new PutObjectCommand({
      Bucket: activeStorageBucketName(ctx.region),
      Key: opaqueKey,
      ContentType: fileType || "application/octet-stream",
      IfNoneMatch: "*",
    });

    const presignedUrl = await getSignedUrl(getS3Client(ctx.region), command, {
      expiresIn: 3600,
    });

    return NextResponse.json({
      uploadUrl: presignedUrl,
      objectKey: opaqueKey,
      bucketId: bucket._id.toString(),
      sessionId,
      spaceId: ctx.spaceId, spaceType: ctx.spaceType,
    });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    if (error instanceof DriveUploadCommitError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message =
      error instanceof Error ? error.message : "Failed to generate upload URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

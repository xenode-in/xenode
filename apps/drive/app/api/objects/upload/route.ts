import { NextRequest, NextResponse } from "next/server";
import {
  bucketOwnershipClause,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { logRequest } from "@/lib/logRequest";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { orgObjectKeyPrefix, teamObjectKeyPrefix } from "@/lib/orgs/storage";
import { uploadObject } from "@/lib/b2/objects";
import { getS3Client } from "@/lib/b2/client";
import { activeStorageBucketName } from "@/lib/storage/region-context";
import { incrementStorage, updateBucketStats } from "@/lib/metering/usage";
import { enforceStorageAccess } from "@/lib/subscriptions/service";

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const ctx = await requireAccessContext(request);
    userId = ctx.userId;
    await enforceStorageAccess(userId);

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const bucketId = formData.get("bucketId") as string | null;
    const encryptedName = formData.get("encryptedName") as string | null;
    const isEncrypted = formData.get("isEncrypted") === "true";

    if (!file) {
      statusCode = 400;
      errorMessage = "No file provided";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    if (!bucketId) {
      statusCode = 400;
      errorMessage = "Bucket ID is required";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      ...bucketOwnershipClause(ctx),
    });

    if (!bucket) {
      statusCode = 404;
      errorMessage = "Bucket not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const allowedSystemPrefix =
      ctx.spaceType === "organization"
        ? orgObjectKeyPrefix(ctx.organizationId!)
        : ctx.spaceType === "team"
          ? teamObjectKeyPrefix(ctx.organizationId!, ctx.teamId!)
          : `users/${ctx.userId}/`;
    const opaqueKey = `${allowedSystemPrefix}${randomBytes(16).toString("hex")}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const size = buffer.length;
    const contentType = file.type || "application/octet-stream";
    // Physical bucket + client follow the caller's region.
    const b2BucketName = activeStorageBucketName(ctx.region);

    let uploadResult: { etag: string; b2FileId: string };
    try {
      uploadResult = await uploadObject(
        b2BucketName,
        opaqueKey,
        buffer,
        contentType,
        size,
        getS3Client(ctx.region),
      );
    } catch (err: unknown) {
      statusCode = 502;
      errorMessage = err instanceof Error ? err.message : "Failed to upload file";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const storageObject = await StorageObject.create({
      bucketId: bucket._id,
      spaceId: ctx.spaceId,
      createdByAccountId: ctx.accountId,
      key: opaqueKey,
      size,
      contentType,
      b2FileId: uploadResult.b2FileId,
      isEncrypted,
      encryptedName: encryptedName ?? undefined,
      uploadSource: "web",
    });

    await incrementStorage(userId, size, { contentType, bucketId, isEncrypted });
    await updateBucketStats(bucket._id.toString(), 1, size);

    statusCode = 201;
    return NextResponse.json({ object: storageObject }, { status: statusCode });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      statusCode = error.status;
      errorMessage = error.message;
      return toJsonResponse(error);
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      statusCode = 401;
      errorMessage = "Unauthorized";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    if (error instanceof Error && error.name === "SubscriptionRequired") {
      statusCode = 402;
      errorMessage = "Active subscription required";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    if (error instanceof Error && error.message === "QUOTA_EXCEEDED") {
      statusCode = 402;
      errorMessage = "Storage quota exceeded";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    statusCode = 500;
    errorMessage = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  } finally {
    logRequest({
      userId,
      method: request.method,
      endpoint: request.nextUrl.pathname,
      statusCode,
      durationMs: Date.now() - startTime,
      ip: request.headers.get("x-forwarded-for") || "unknown",
      userAgent: request.headers.get("user-agent") || "unknown",
      errorMessage,
    });
  }
}

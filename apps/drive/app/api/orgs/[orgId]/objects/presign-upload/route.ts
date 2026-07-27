import { randomBytes } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import {
  loadOrgBucket,
  orgObjectKeyPrefix,
  requireOrgStorageMembership,
} from "@/lib/orgs/storage";
import { assertOrgStorageHeadroom } from "@/lib/orgs/billing/orgUsage";
import { enforceRateLimit } from "@/lib/ratelimit/limiter";
import { getS3Client } from "@/lib/b2/client";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

function safePathPart(value: string): string {
  return value.replace(/[\/\\]/g, "_");
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await requireOrgStorageMembership({ userId: ctx.userId, orgId, action: "write" });
    await enforceRateLimit({
      key: `org-presign:${ctx.userId}`,
      limit: 600,
      windowMs: 60 * 1000,
    });

    const {
      bucketId,
      fileName,
      fileType,
      size,
      prefix = orgObjectKeyPrefix(orgId),
    } = await request.json().catch(() => ({}));

    if (!bucketId) {
      return NextResponse.json({ error: "bucketId required" }, { status: 400 });
    }

    // Soft pre-check when the client sends the size — the authoritative,
    // atomic ceiling enforcement happens at complete-upload.
    const uploadSize = Number(size);
    if (Number.isFinite(uploadSize) && uploadSize > 0) {
      await assertOrgStorageHeadroom(orgId, uploadSize);
    }

    const basePrefix =
      typeof prefix === "string" && prefix.startsWith(orgObjectKeyPrefix(orgId))
        ? prefix
        : orgObjectKeyPrefix(orgId);
    const safeFileName = safePathPart(
      typeof fileName === "string" && fileName.trim()
        ? fileName.trim()
        : randomBytes(16).toString("hex"),
    );
    const objectKey = `${basePrefix}${safeFileName}`;

    await dbConnect();
    const bucket = await loadOrgBucket({ orgId, bucketId, action: "write" });
    const s3Client = getS3Client(bucket.storageRegion);
    const command = new PutObjectCommand({
      Bucket: bucket.b2BucketId,
      Key: objectKey,
      ContentType: fileType || "application/octet-stream",
    });
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return NextResponse.json({
      uploadUrl,
      objectKey,
      bucketId: bucket._id.toString(),
      spaceId: ctx.spaceId,
      spaceType: ctx.spaceType,
    });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to generate organization upload URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

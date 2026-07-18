import { randomBytes } from "crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import {
  loadTeamBucket,
  requireTeamStorageMembership,
  teamObjectKeyPrefix,
} from "@/lib/orgs/storage";
import { assertOrgStorageHeadroom } from "@/lib/orgs/billing/orgUsage";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string; teamId: string }>;
}

function safePathPart(value: string): string {
  return value.replace(/[\/\\]/g, "_");
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId, teamId } = await params;
    await requireTeamStorageMembership({ userId: ctx.userId, orgId, teamId });

    const prefixDefault = teamObjectKeyPrefix(orgId, teamId);
    const {
      bucketId,
      fileName,
      fileType,
      size,
      prefix = prefixDefault,
    } = await request.json().catch(() => ({}));

    if (!bucketId) {
      return NextResponse.json({ error: "bucketId required" }, { status: 400 });
    }

    const uploadSize = Number(size);
    if (Number.isFinite(uploadSize) && uploadSize > 0) {
      await assertOrgStorageHeadroom(orgId, uploadSize);
    }

    const S3_KEY_ID = process.env.S3_KEY_ID?.trim();
    const S3_APPLICATION_KEY = process.env.S3_APPLICATION_KEY?.trim();
    if (!S3_KEY_ID || !S3_APPLICATION_KEY) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

    const basePrefix =
      typeof prefix === "string" && prefix.startsWith(prefixDefault)
        ? prefix
        : prefixDefault;
    const safeFileName = safePathPart(
      typeof fileName === "string" && fileName.trim()
        ? fileName.trim()
        : randomBytes(16).toString("hex"),
    );
    const objectKey = `${basePrefix}${safeFileName}`;

    await dbConnect();
    const bucket = await loadTeamBucket({ orgId, teamId, bucketId });
    const s3Client = new S3Client({
      endpoint: process.env.S3_ENDPOINT || "https://s3.us-west-004.backblazeb2.com",
      region: process.env.S3_REGION || "us-west-004",
      credentials: {
        accessKeyId: S3_KEY_ID,
        secretAccessKey: S3_APPLICATION_KEY,
      },
      forcePathStyle: true,
    });
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
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to generate team upload URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

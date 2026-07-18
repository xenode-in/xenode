import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { getS3Client } from "@/lib/b2/client";
import dbConnect from "@/lib/mongodb";
import {
  assertOrgObjectKey,
  loadOrgBucket,
  orgObjectClause,
  requireOrgStorageMembership,
} from "@/lib/orgs/storage";
import {
  adjustOrgStorage,
  decrementOrgStorage,
  incrementOrgStorage,
} from "@/lib/orgs/billing/orgUsage";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import { sizeBucket } from "@/lib/posthog";
import Bucket from "@/models/Bucket";
import { organizationSpaceId } from "@xenode/spaces/ids";
import StorageObject from "@/models/StorageObject";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

type MediaCategory =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "pdf"
  | "word"
  | "excel"
  | "powerpoint"
  | "archive"
  | "code"
  | "other";

function getMediaCategory(mimeType: string): MediaCategory {
  const value = mimeType.toLowerCase();
  if (value.startsWith("image/")) return "image";
  if (value.startsWith("video/")) return "video";
  if (value.startsWith("audio/")) return "audio";
  if (value.includes("pdf")) return "pdf";
  if (value.includes("spreadsheet") || value.includes("excel") || value.includes("csv")) return "excel";
  if (value.includes("wordprocessing") || value.includes("word") || value.includes("doc")) return "word";
  if (value.includes("presentation") || value.includes("powerpoint") || value.includes("ppt")) return "powerpoint";
  if (value.includes("zip") || value.includes("tar") || value.includes("rar") || value.includes("archive")) return "archive";
  if (value.includes("json") || value.includes("javascript") || value.includes("html") || value.includes("xml") || value.includes("text/css")) return "code";
  if (value.includes("document") || value.startsWith("text/")) return "document";
  return "other";
}

function assertSpaceWrappedEncryption(body: Record<string, unknown>) {
  const spaceKeyVersion = Number(body.spaceKeyVersion);
  if (
    body.isEncrypted !== true ||
    body.wrappedBy !== "space" ||
    typeof body.encryptedDEK !== "string" ||
    !body.encryptedDEK.trim() ||
    !Number.isInteger(spaceKeyVersion) ||
    spaceKeyVersion < 1
  ) {
    return NextResponse.json(
      {
        error:
          "Organization uploads must be encrypted and wrapped by the organization space key",
        code: "org_space_wrapped_encryption_required",
      },
      { status: 400 },
    );
  }
  return null;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await requireOrgStorageMembership({ userId: ctx.userId, orgId, action: "write" });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const encryptionError = assertSpaceWrappedEncryption(body);
    if (encryptionError) return encryptionError;

    const objectKey = assertOrgObjectKey({ orgId, key: body.objectKey });
    const bucketId = typeof body.bucketId === "string" ? body.bucketId : "";
    const size = Number(body.size);
    const contentType =
      typeof body.originalContentType === "string"
        ? body.originalContentType
        : typeof body.contentType === "string"
          ? body.contentType
          : "application/octet-stream";

    if (!bucketId || !Number.isFinite(size) || size < 0) {
      return NextResponse.json(
        { error: "bucketId, objectKey, and size are required" },
        { status: 400 },
      );
    }

    await dbConnect();
    const bucket = await loadOrgBucket({ orgId, bucketId, action: "write" });

    let b2FileId = "";
    try {
      const s3Response = await getS3Client().send(
        new HeadObjectCommand({
          Bucket: bucket.b2BucketId,
          Key: objectKey,
        }),
      );
      b2FileId = s3Response.VersionId || `${bucket.b2BucketId}/${objectKey}`;
    } catch {
      return NextResponse.json(
        { error: "File not found in storage" },
        { status: 404 },
      );
    }

    const mediaCategory = getMediaCategory(contentType);
    const objectUpdate = {
      bucketId: new mongoose.Types.ObjectId(bucketId),
      spaceId: organizationSpaceId(orgId),
      createdByAccountId: ctx.accountId,
      key: objectKey,
      size,
      contentType,
      encryptedContentType:
        typeof body.encryptedContentType === "string"
          ? body.encryptedContentType
          : undefined,
      mediaCategory,
      b2FileId,
      thumbnail: typeof body.thumbnail === "string" ? body.thumbnail : undefined,
      isEncrypted: true,
      encryptedDEK: String(body.encryptedDEK),
      wrappedBy: "space" as const,
      spaceKeyVersion: Number(body.spaceKeyVersion),
      spaceKeyWrapIv:
        typeof body.spaceKeyWrapIv === "string" ? body.spaceKeyWrapIv : undefined,
      iv: typeof body.iv === "string" ? body.iv : undefined,
      encryptedName:
        typeof body.encryptedName === "string" ? body.encryptedName : undefined,
      encryptedMetadata:
        typeof body.encryptedMetadata === "string"
          ? body.encryptedMetadata
          : undefined,
      uploadSource: "web" as const,
      lastAccessedAt: new Date(),
    };

    const existingObject = await StorageObject.findOne({
      bucketId,
      key: objectKey,
      ...orgObjectClause(orgId),
    });

    if (existingObject) {
      const sizeDiff = size - existingObject.size;
      // Enforce the org ceiling on growth before persisting (throws 402).
      if (sizeDiff !== 0) {
        await adjustOrgStorage(orgId, sizeDiff);
      }
      Object.assign(existingObject, objectUpdate);
      await existingObject.save();
      if (sizeDiff !== 0) {
        await Bucket.updateOne(
          { _id: bucket._id },
          { $inc: { totalSizeBytes: sizeDiff } },
        );
      }
      return NextResponse.json({ object: existingObject });
    }

    // Reserve org quota atomically first (throws 402 if it would exceed the
    // ceiling); roll back the reservation if the metadata write then fails.
    await incrementOrgStorage(orgId, size);
    let object;
    try {
      object = await StorageObject.create(objectUpdate);
    } catch (err) {
      await decrementOrgStorage(orgId, size).catch(() => {});
      throw err;
    }
    await Bucket.updateOne(
      { _id: bucket._id },
      { $inc: { objectCount: 1, totalSizeBytes: size } },
    );

    // Audit: object id + size bucket only — never the plaintext name or key.
    await emitActivity({
      orgId,
      action: ActivityAction.FILE_UPLOADED,
      actorUserId: ctx.userId,
      target: { type: "object", id: object._id.toString() },
      metadata: { sizeBucket: sizeBucket(size), bucketId },
    });

    return NextResponse.json({ object }, { status: 201 });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to complete organization upload";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

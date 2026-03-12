import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { logRequest } from "@/lib/logRequest";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { uploadObject } from "@/lib/b2/objects";
import { incrementStorage, updateBucketStats } from "@/lib/metering/usage";

/**
 * POST /api/objects/upload - Direct (non-presigned) file upload.
 *
 * GAP-4: Object key is generated server-side as an opaque random hex string.
 * The original filename NEVER appears in the B2 storage path or MongoDB key field.
 * Display name must be stored exclusively in StorageObject.encryptedName.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const session = await requireAuth();
    userId = session.user.id;

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const bucketId = formData.get("bucketId") as string | null;
    // encryptedName is the AES-GCM encrypted display name from the client
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
      $or: [{ userId }, { userId: "system" }],
    });

    if (!bucket) {
      statusCode = 404;
      errorMessage = "Bucket not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    if (bucket.userId === "system") {
      // System bucket — ownership validated above, opaque key will be scoped to userId
    }

    /**
     * GAP-4: Opaque key — never use file.name as the storage key.
     * Format: users/{userId}/{randomHex32}
     */
    const opaqueKey = `users/${userId}/${randomBytes(16).toString("hex")}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const size = buffer.length;
    const contentType = file.type || "application/octet-stream";
    const b2BucketName = bucket.b2BucketId;

    let uploadResult: { etag: string; b2FileId: string };
    try {
      uploadResult = await uploadObject(
        b2BucketName,
        opaqueKey, // opaque key — not filename
        buffer,
        contentType,
        size,
      );
    } catch (err: unknown) {
      statusCode = 502;
      errorMessage =
        err instanceof Error ? err.message : "Failed to upload file";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    // Create object record — key is opaque, display name is in encryptedName
    const storageObject = await StorageObject.create({
      bucketId: bucket._id,
      userId,
      key: opaqueKey,
      size,
      contentType,
      b2FileId: uploadResult.b2FileId,
      isEncrypted,
      encryptedName: encryptedName ?? undefined,
    });

    await incrementStorage(userId, size, { contentType, bucketId, isEncrypted });
    await updateBucketStats(bucket._id.toString(), 1, size);

    statusCode = 201;
    return NextResponse.json({ object: storageObject }, { status: statusCode });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      statusCode = 401;
      errorMessage = "Unauthorized";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    if (error instanceof Error && error.message === "QUOTA_EXCEEDED") {
      statusCode = 402;
      errorMessage = "Storage quota exceeded";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    statusCode = 500;
    errorMessage =
      error instanceof Error ? error.message : "Internal server error";
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

import { updateDriveObjectMetadata, DriveSyncError } from "@xenode/database";
import { NextRequest, NextResponse } from "next/server";
import { requireAccessContext, objectFilter, bucketOwnershipClause, isAuthzError, toJsonResponse } from "@/lib/authz";
import { logRequest } from "@/lib/logRequest";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { fileUrlLifetime } from "@/lib/b2/cdn";
import { getDownloadUrl } from "@/lib/b2/objects";
import { DriveUploadCommitError } from "@xenode/database";
import { enforceStorageAccess } from "@/lib/subscriptions/service";
import {
  publishSyncEvent,
  toSyncObjectSnapshot,
} from "@/lib/realtime/publish";
import { binObjectsInSpace } from "@/lib/storage/bin-objects";
import { folderListingId } from "@/lib/storage/folders";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** 
 * GET /api/objects/[id] - Get download URL for an object 
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const ctx = await requireAccessContext(request);
    userId = ctx.userId;
    await enforceStorageAccess(userId);

    const { id } = await params;
    const isPreview = request.nextUrl.searchParams.get("preview") === "true";

    await dbConnect();

    const object = await StorageObject.findOne(objectFilter(ctx, id)).lean();
    if (!object) {
      statusCode = 404;
      errorMessage = "Object not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    // Mark as recently opened. This GET is the "open file" signal (preview /
    // download fetch the object here; thumbnails do NOT — they go through the
    // /api/files proxy), so it's the right place to drive the Recent view.
    // Fire-and-forget so it never delays the response.
    void StorageObject.updateOne(
      { _id: object._id },
      { $set: { lastAccessedAt: new Date() } },
      { timestamps: false },
    ).catch(() => {});

    const bucket = await Bucket.findOne({
      _id: object.bucketId,
      ...bucketOwnershipClause(ctx),
    })
      .select("b2BucketId")
      .lean();

    if (!bucket) {
      statusCode = 404;
      errorMessage = "Bucket not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const hasOptimizedVersion = !!object.optimizedKey && !!object.optimizedEncryptedDEK;
    const useOptimized = isPreview && hasOptimizedVersion;

    const keyToUse = useOptimized ? object.optimizedKey : object.key;
    const dekToUse = useOptimized ? object.optimizedEncryptedDEK : object.encryptedDEK;
    const ivToUse = useOptimized ? object.optimizedIV : object.iv;
    const spaceKeyWrapIvToUse = useOptimized
      ? object.optimizedSpaceKeyWrapIv
      : object.spaceKeyWrapIv;
    const contentTypeToUse = useOptimized ? object.optimizedContentType : object.contentType;
    const sizeToUse = useOptimized ? object.optimizedSize : object.size;

    let url = "";
    let chunkUrls: string[] | undefined = undefined;

    const isChunked = !useOptimized && object.chunks && object.chunks.length > 0;

    if (isChunked) {
      const sortedChunks = [...(object.chunks || [])].sort((a, b) => a.index - b.index);
      chunkUrls = await Promise.all(
        sortedChunks.map((chunk) => getDownloadUrl(bucket.b2BucketId, chunk.key, fileUrlLifetime(ctx.session?.session.expiresAt)))
      );
    } else {
      url = await getDownloadUrl(
        bucket.b2BucketId, 
        keyToUse!, 
        fileUrlLifetime(ctx.session?.session.expiresAt)
      );
    }

    const sidecars = await StorageObject.find({
      parentObjectId: object._id,
      spaceId: ctx.spaceId,
      deletedAt: { $exists: false },
    }).select("mediaCategory encryptedName size contentType encryptedContentType").lean();

    return NextResponse.json({
      url,
      chunkUrls,
      isEncrypted: object.isEncrypted ?? false,
      encryptedDEK: dekToUse ?? null,
      wrappedBy: object.wrappedBy ?? null,
      spaceKeyVersion: object.spaceKeyVersion ?? null,
      spaceKeyWrapIv: spaceKeyWrapIvToUse ?? null,
      iv: ivToUse ?? null,
      encryptedName: object.encryptedName ?? null,
      encryptedContentType: object.encryptedContentType ?? null,
      encryptedDisplayName: object.encryptedDisplayName ?? null,
      mediaCategory: object.mediaCategory ?? null,
      contentType: contentTypeToUse,
      size: sizeToUse,
      revision: object.revision ?? 0,
      updatedAt: object.updatedAt,
      spaceId: object.spaceId,
      spaceType: ctx.spaceType,
      canWrite: ctx.spaceType === "personal" || ctx.role !== "guest",
      chunkSize: object.chunkSize ?? null,
      chunkCount: object.chunkCount ?? null,
      chunkIvs: object.chunkIvs ?? null,
      encryptedMetadata: object.encryptedMetadata ?? null, // needed for audioTracks/subtitleTracks at playback
      sidecars: sidecars.map(s => ({
        id: s._id.toString(),
        mediaCategory: s.mediaCategory,
        encryptedName: s.encryptedName,
        size: s.size,
        contentType: s.contentType,
        encryptedContentType: s.encryptedContentType
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: unknown) {
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

/** 
 * DELETE /api/objects/[id] - Delete an object 
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const ctx = await requireAccessContext(request, "delete");
    userId = ctx.userId;
    await enforceStorageAccess(userId);

    const { id } = await params;

    await dbConnect();

    const object = await StorageObject.findOne(objectFilter(ctx, id))
      .select("_id")
      .lean();
    if (!object) {
      statusCode = 404;
      errorMessage = "Object not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    // Soft delete to the Bin: a folder takes its live subtree, a file its
    // sidecars. Blobs and metering remain until the Bin purge contract.
    await binObjectsInSpace(ctx, [String(object._id)]);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof DriveSyncError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (isAuthzError(error)) {
      statusCode = error.status;
      errorMessage = error.message;
      return toJsonResponse(error);
    }
    if (error instanceof DriveUploadCommitError) {
      statusCode = error.status;
      errorMessage = error.message;
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
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

/** 
 * PATCH /api/objects/[id] - Update object metadata (tags, position) 
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const ctx = await requireAccessContext(request, "write");
    userId = ctx.userId;
    await enforceStorageAccess(userId);

    const { id } = await params;

    let body;
    try {
      body = await request.json();
    } catch {
      statusCode = 400;
      errorMessage = "Invalid JSON";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const { tags, position, starred } = body;

    await dbConnect();

    const updated = await updateDriveObjectMetadata({ spaceId: ctx.spaceId, objectId: id, tags, position, starred });
    if (!updated) return NextResponse.json({ error: "Object not found" }, { status: 404 });
    const object = await StorageObject.findById(updated._id);
    if (!object) return NextResponse.json({ error: "Object not found" }, { status: 404 });
    const eventType =
      starred === true
        ? "FILE_STARRED"
        : starred === false
          ? "FILE_UNSTARRED"
          : "FILE_UPDATED";
    await publishSyncEvent({
      userId,
      spaceId: ctx.spaceId,
      type: eventType,
      payload: {
        bucketId: object.bucketId.toString(),
        objectId: object._id.toString(),
        folderIds: [folderListingId(object.folderId)],
        object: toSyncObjectSnapshot(object),
      },
      invalidateFolders: [object.folderId ?? null],
      invalidateRecent: true,
    });

    return NextResponse.json({ object });
  } catch (error: unknown) {
    if (error instanceof DriveSyncError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
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

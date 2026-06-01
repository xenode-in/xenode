import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { logRequest } from "@/lib/logRequest";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { getDownloadUrl } from "@/lib/b2/objects";
import ShareLink from "@/models/ShareLink";
import DirectShare from "@/models/DirectShare";
import { enforceStorageAccess } from "@/lib/subscriptions/service";

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
    const session = await requireAuth(request);
    userId = session.user.id;
    await enforceStorageAccess(userId);

    const { id } = await params;
    const isPreview = request.nextUrl.searchParams.get("preview") === "true";

    await dbConnect();

    const object = await StorageObject.findOne({ _id: id, userId }).lean();
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
    ).catch(() => {});

    const bucket = await Bucket.findOne({
      _id: object.bucketId,
      $or: [{ userId }, { userId: "system" }],
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
    const contentTypeToUse = useOptimized ? object.optimizedContentType : object.contentType;
    const sizeToUse = useOptimized ? object.optimizedSize : object.size;

    let url = "";
    let chunkUrls: string[] | undefined = undefined;

    const isChunked = !useOptimized && object.chunks && object.chunks.length > 0;

    if (isChunked) {
      const sortedChunks = [...(object.chunks || [])].sort((a, b) => a.index - b.index);
      chunkUrls = await Promise.all(
        sortedChunks.map((chunk) => getDownloadUrl(bucket.b2BucketId, chunk.key))
      );
    } else {
      url = await getDownloadUrl(
        bucket.b2BucketId, 
        keyToUse!, 
        3600, 
        object.iv
      );
    }

    const sidecars = await StorageObject.find({ 
      parentObjectId: object._id, 
      deletedAt: { $exists: false } 
    }).select("mediaCategory encryptedName size contentType encryptedContentType").lean();

    return NextResponse.json({
      url,
      chunkUrls,
      isEncrypted: object.isEncrypted ?? false,
      encryptedDEK: dekToUse ?? null,
      iv: ivToUse ?? null,
      encryptedName: object.encryptedName ?? null,
      encryptedContentType: object.encryptedContentType ?? null,
      encryptedDisplayName: object.encryptedDisplayName ?? null,
      mediaCategory: object.mediaCategory ?? null,
      contentType: contentTypeToUse,
      size: sizeToUse,
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
    });
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
    const session = await requireAuth(request);
    userId = session.user.id;
    await enforceStorageAccess(userId);

    const { id } = await params;

    await dbConnect();

    const object = await StorageObject.findOne({ _id: id, userId }).lean();
    if (!object) {
      statusCode = 404;
      errorMessage = "Object not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    // Soft-delete → Bin. The encrypted B2 blobs (main + thumbnail + optimized,
    // plus any sidecars) are intentionally NOT removed here so the item can be
    // restored within the 30-day window. They're purged later by the user
    // ("delete forever" / empty bin → /api/objects/purge) or by the
    // /api/cron/purge-bin job. Storage metering is likewise NOT decremented:
    // the bytes still occupy B2, so binned items keep counting against quota
    // until they're actually purged.
    const now = new Date();
    await StorageObject.findByIdAndUpdate(object._id, {
      $set: { deletedAt: now },
    });

    // Cascade the soft-delete to sidecar children (subtitles, extra audio).
    await StorageObject.updateMany(
      { parentObjectId: object._id, userId },
      { $set: { deletedAt: now } },
    );

    // Revoke any active shares — a binned item shouldn't stay publicly
    // reachable. (Restore does not bring shares back; re-share if needed.)
    await ShareLink.deleteMany({ objectId: object._id });
    await DirectShare.deleteMany({ objectId: object._id });

    return NextResponse.json({ success: true });
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
 * PATCH /api/objects/[id] - Update object metadata (tags, position) 
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const session = await requireAuth(request);
    userId = session.user.id;
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

    const object = await StorageObject.findOne({ _id: id, userId });
    if (!object) {
      statusCode = 404;
      errorMessage = "Object not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    if (tags !== undefined) object.tags = tags;
    if (position !== undefined) object.position = position;
    if (starred !== undefined) object.starred = !!starred;

    await object.save();

    return NextResponse.json({ object });
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

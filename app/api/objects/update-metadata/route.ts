import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import StorageObject from "@/models/StorageObject";
import { logRequest } from "@/lib/logRequest";

export const dynamic = "force-dynamic";

/**
 * POST /api/objects/update-metadata
 * Updates metadata for a storage object, typically used after a Google Photos migration upload.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const session = await requireAuth(request);
    userId = session.user.id;

    const {
      objectKey,
      bucketId,
      takenAt,
      createdAt,
      description,
      googlePhotosUrl,
    } = await request.json();

    // ❌ No fallback — strict mode
    if (!objectKey) {
      statusCode = 400;
      errorMessage = "objectKey is required";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    await dbConnect();

    // -------------------------
    // BUILD UPDATE DATA
    // -------------------------
    const updateData: any = {};

    if (takenAt) {
      updateData.takenAt = new Date(Number(takenAt) * 1000);
    }

    // ✅ Google priority: takenAt > createdAt
    const finalCreatedAt = takenAt || createdAt;

    if (finalCreatedAt) {
      updateData.createdAt = new Date(Number(finalCreatedAt) * 1000);
      updateData.updatedAt = new Date(Number(finalCreatedAt) * 1000);
    }

    if (description) updateData.description = description;
    if (googlePhotosUrl) updateData.googlePhotosUrl = googlePhotosUrl;

    // -------------------------
    // UPDATE (bypass mongoose)
    // -------------------------
    const result = await StorageObject.collection.updateOne(
      {
        userId,
        key: objectKey,
      },
      { $set: updateData },
    );

    if (result.matchedCount === 0) {
      statusCode = 404;
      errorMessage = "Storage object not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    // -------------------------
    // FETCH UPDATED DOCUMENT
    // -------------------------
    const storageObject = await StorageObject.findOne({
      userId,
      key: objectKey,
      ...(bucketId && { bucketId }),
    });

    if (!storageObject) {
      statusCode = 404;
      errorMessage = "Updated object not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    return NextResponse.json({
      success: true,
      object: {
        id: storageObject._id,
        key: storageObject.key,
        takenAt: storageObject.takenAt,
        createdAt: storageObject.createdAt,
        updatedAt: storageObject.updatedAt,
      },
    });
  } catch (error: any) {
    if (error.message === "Unauthorized") {
      statusCode = 401;
      errorMessage = "Unauthorized";
    } else {
      statusCode = 500;
      errorMessage = error.message || "Internal server error";
    }

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

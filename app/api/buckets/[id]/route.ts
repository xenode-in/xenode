import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { logRequest } from "@/lib/logRequest";

export const dynamic = "force-dynamic";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { deleteB2Bucket } from "@/lib/b2/buckets";
import { deleteObject as deleteB2Object } from "@/lib/b2/objects";
import { decrementBucketCount, decrementStorage } from "@/lib/metering/usage";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET /api/buckets/[id] - Get bucket details */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const session = await requireAuth(request);
    userId = session.user.id;
    const { id } = await params;

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: id,
      $or: [{ userId }, { userId: "system" }],
    }).lean();

    if (!bucket) {
      statusCode = 404;
      errorMessage = "Bucket not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    return NextResponse.json({ bucket });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      statusCode = 401;
      errorMessage = "Unauthorized";
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

/** DELETE /api/buckets/[id] - Delete a bucket and all its objects */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const session = await requireAuth(request);
    userId = session.user.id;
    const { id } = await params;

    await dbConnect();

    const bucket = await Bucket.findOne({ _id: id, userId });
    if (!bucket) {
      statusCode = 404;
      errorMessage = "Bucket not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const objects = await StorageObject.find({ bucketId: bucket._id });
    const b2BucketName = `xn-${userId.slice(0, 8)}-${bucket.name}`;

    for (const obj of objects) {
      try {
        await deleteB2Object(b2BucketName, obj.key);
      } catch {
        // Continue even if B2 delete fails
      }
    }

    const totalSize = objects.reduce((sum, obj) => sum + obj.size, 0);
    await StorageObject.deleteMany({ bucketId: bucket._id });

    try {
      await deleteB2Bucket(b2BucketName);
    } catch {
      // B2 bucket might already be deleted
    }

    await Bucket.findByIdAndDelete(bucket._id);
    await decrementBucketCount(userId);
    if (totalSize > 0) await decrementStorage(userId, totalSize);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      statusCode = 401;
      errorMessage = "Unauthorized";
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

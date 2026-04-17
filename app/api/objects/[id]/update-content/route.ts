import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import StorageObject from "@/models/StorageObject";
import Bucket from "@/models/Bucket";
import { getUploadUrl, uploadObject } from "@/lib/b2/objects";
import { updateBucketStats } from "@/lib/metering/usage";

export const dynamic = "force-dynamic";

/**
 * POST /api/objects/[id]/update-content
 * Overwrites an existing object's content.
 *
 * For direct server uploads, send application/octet-stream with ?iv=<base64>.
 * JSON requests are kept for the older presigned-url flow.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth(request);
    const userId = session.user.id;
    const { id } = await params;
    const contentType = request.headers.get("content-type") || "";
    const isJsonRequest = contentType.includes("application/json");
    const body = isJsonRequest ? await request.json() : null;
    const iv = isJsonRequest ? body?.iv : request.nextUrl.searchParams.get("iv");

    if (!iv) {
      return NextResponse.json({ error: "IV is required" }, { status: 400 });
    }

    await dbConnect();

    const object = await StorageObject.findOne({ _id: id, userId });
    if (!object) {
      return NextResponse.json({ error: "Object not found" }, { status: 404 });
    }

    const bucket = await Bucket.findOne({
      _id: object.bucketId,
      $or: [{ userId }, { userId: "system" }],
    });

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    if (!isJsonRequest) {
      const arrayBuffer = await request.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.byteLength === 0) {
        return NextResponse.json({ error: "File content is required" }, { status: 400 });
      }

      const oldSize = object.size;
      const sizeDiff = buffer.byteLength - oldSize;

      const uploadResult = await uploadObject(
        bucket.b2BucketId,
        object.key,
        buffer,
        "application/octet-stream",
        buffer.byteLength,
      );

      object.iv = iv;
      object.size = buffer.byteLength;
      object.b2FileId = uploadResult.b2FileId;
      object.updatedAt = new Date();
      await object.save();

      if (sizeDiff !== 0) {
        await updateBucketStats(object.bucketId.toString(), 0, sizeDiff);
      }

      return NextResponse.json({ success: true, object });
    }

    // Legacy presigned-url flow. The docs editor now uses the direct upload path above.
    object.iv = iv;
    await object.save();

    const uploadUrl = await getUploadUrl(bucket.b2BucketId, object.key, "application/octet-stream");

    return NextResponse.json({ uploadUrl });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

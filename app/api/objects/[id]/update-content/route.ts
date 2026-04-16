import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import StorageObject from "@/models/StorageObject";
import Bucket from "@/models/Bucket";
import { getUploadUrl } from "@/lib/b2/objects";

export const dynamic = "force-dynamic";

/**
 * POST /api/objects/[id]/update-content
 * Generates a presigned URL to overwrite an existing object's content.
 * Updates the IV in the database immediately to prepare for the new encrypted content.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth(request);
    const userId = session.user.id;
    const { id } = await params;
    const { iv } = await request.json();

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

    // 1. Update IV in database (we do this now so the metadata matches the soon-to-be-uploaded content)
    object.iv = iv;
    await object.save();

    // 2. Generate presigned URL for the EXISTING key
    const uploadUrl = await getUploadUrl(bucket.b2BucketId, object.key, "application/octet-stream");

    return NextResponse.json({ uploadUrl });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

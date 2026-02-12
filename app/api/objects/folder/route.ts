import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { uploadObject } from "@/lib/b2/objects";

export const dynamic = "force-dynamic";

/**
 * POST /api/objects/folder - Create a new folder (empty object with trailing slash)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;
    const body = await request.json();
    const { bucketId, name, prefix = "" } = body;

    if (!bucketId || !name) {
      return NextResponse.json(
        { error: "Bucket ID and folder name are required" },
        { status: 400 },
      );
    }

    // Validate folder name (simple alphanumeric + dashes/underscores)
    if (!/^[a-zA-Z0-9\-_ ]+$/.test(name)) {
      return NextResponse.json(
        { error: "Folder name contains invalid characters" },
        { status: 400 },
      );
    }

    await dbConnect();

    // Verify bucket ownership
    const bucket = await Bucket.findOne({ _id: bucketId, userId });
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    // Construct full key with trailing slash
    const fullKey = `${prefix}${name}/`;
    const b2BucketName = `xn-${userId.slice(0, 8)}-${bucket.name}`;

    // Check if folder already exists
    const existing = await StorageObject.findOne({
      bucketId,
      key: fullKey,
    });

    if (existing) {
      return NextResponse.json(
        { error: "Folder already exists" },
        { status: 409 },
      );
    }

    // Upload 0-byte object to B2
    const uploadResult = await uploadObject(
      b2BucketName,
      fullKey,
      Buffer.from(""), // Empty body
      "application/x-directory",
      0,
    );

    // Create database record
    const folder = await StorageObject.create({
      bucketId: bucket._id,
      userId,
      key: fullKey,
      size: 0,
      contentType: "application/x-directory",
      b2FileId: uploadResult.b2FileId,
    });

    // We don't increment storage usage for folders (0 bytes)
    // But we might want to increment object count?
    // Let's increment object count for now
    await Bucket.updateOne({ _id: bucket._id }, { $inc: { objectCount: 1 } });

    return NextResponse.json({ folder }, { status: 201 });
  } catch (error: unknown) {
    console.error("Create folder error:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Failed to create folder" },
      { status: 500 },
    );
  }
}

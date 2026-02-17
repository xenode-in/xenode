import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const B2_ENDPOINT =
      process.env.B2_ENDPOINT || "https://s3.us-west-004.backblazeb2.com";
    const B2_REGION = process.env.B2_REGION || "us-west-004";
    const B2_KEY_ID = process.env.B2_KEY_ID;
    const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY;

    if (!B2_KEY_ID || !B2_APPLICATION_KEY) {
      console.error("Missing B2 credentials");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

    const keyId = B2_KEY_ID.trim();
    const appKey = B2_APPLICATION_KEY.trim();

    const {
      fileName,
      fileSize,
      fileType,
      bucketId,
      prefix = "",
    } = await request.json();

    if (!fileName || !bucketId) {
      return NextResponse.json(
        { error: "fileName and bucketId required" },
        { status: 400 },
      );
    }

    await dbConnect();

    // Verify bucket ownership
    const bucket = await Bucket.findOne({
      _id: bucketId,
      $or: [{ userId }, { userId: "system" }],
    });

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    // Enforce prefix for system bucket
    if (bucket.userId === "system" && !prefix.startsWith(`users/${userId}/`)) {
      return NextResponse.json(
        { error: "Access denied to this folder" },
        { status: 403 },
      );
    }

    const objectKey = `${prefix}${fileName}`;

    // Configure S3 client for B2
    const s3Client = new S3Client({
      endpoint: B2_ENDPOINT,
      region: B2_REGION,
      credentials: {
        accessKeyId: keyId,
        secretAccessKey: appKey,
      },
      forcePathStyle: true,
    });

    // Generate presigned PUT URL
    const command = new PutObjectCommand({
      Bucket: bucket.b2BucketId,
      Key: objectKey,
      ContentType: fileType || "application/octet-stream",
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 1 hour validity
    });

    return NextResponse.json({
      uploadUrl: presignedUrl,
      objectKey,
      bucketId: bucket._id.toString(),
    });
  } catch (error) {
    console.error("Presigned URL generation error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to generate upload URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

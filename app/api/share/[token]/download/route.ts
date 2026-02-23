import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import ShareLink from "@/models/ShareLink";
import StorageObject from "@/models/StorageObject";
import Bucket from "@/models/Bucket";
import { getSignedFileUrl } from "@/lib/b2/cdn";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ token: string }>;
}

/** POST /api/share/[token]/download — Validate & return signed download URL */
export async function POST(req: NextRequest, { params }: Params) {
  const resolvedParams = await params;
  const body = await req.json().catch(() => ({}));
  const { password } = body;

  await dbConnect();

  const link = await ShareLink.findOne({
    token: resolvedParams.token,
    isRevoked: false,
  });
  if (!link)
    return NextResponse.json(
      { error: "Link not found or revoked" },
      { status: 404 },
    );

  if (link.expiresAt && new Date() > link.expiresAt)
    return NextResponse.json(
      { error: "This link has expired" },
      { status: 410 },
    );

  if (link.maxDownloads && link.downloadCount >= link.maxDownloads)
    return NextResponse.json(
      { error: "Download limit reached" },
      { status: 410 },
    );

  if (link.isPasswordProtected) {
    if (!password)
      return NextResponse.json({ error: "Password required" }, { status: 401 });
    const valid = await bcrypt.compare(password, link.passwordHash!);
    if (!valid)
      return NextResponse.json(
        { error: "Incorrect password" },
        { status: 401 },
      );
  }

  const object = await StorageObject.findById(link.objectId);
  if (!object)
    return NextResponse.json({ error: "File not found" }, { status: 404 });

  const bucket = await Bucket.findById(object.bucketId);
  if (!bucket)
    return NextResponse.json({ error: "Bucket not found" }, { status: 404 });

  // Increment download count (non-blocking)
  ShareLink.findByIdAndUpdate(link._id, { $inc: { downloadCount: 1 } }).exec();

  // Generate a short-lived signed URL (1 hour) using your existing cdn utility
  const signedUrl = await getSignedFileUrl(bucket.name, object.key, 3600);

  return NextResponse.json({
    downloadUrl: signedUrl,
    isEncrypted: object.isEncrypted,
    iv: object.iv,
    contentType: object.contentType,
    fileName: object.key.split("/").pop() ?? object.key,
  });
}

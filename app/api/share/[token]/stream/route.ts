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

/**
 * POST /api/share/[token]/stream
 *
 * Validates the share link and returns a short-lived signed URL suitable for
 * previewing (streaming) the file directly in the browser.
 *
 * Unlike /download, this route does NOT increment the downloadCount so that
 * previewing a file doesn't consume the user's download allowance.
 *
 * For non-encrypted files the client can hand this URL directly to a <video>
 * element so the browser handles byte-range requests and native streaming.
 * For encrypted files the client still needs to fetch → decrypt → blob-URL,
 * but at least the signed URL is obtained cheaply here.
 */
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

  // 1-hour signed URL — enough for a preview session
  const signedUrl = await getSignedFileUrl(bucket.name, object.key, 3600);

  return NextResponse.json({
    streamUrl: signedUrl,
    isEncrypted: object.isEncrypted,
    iv: object.iv,
    contentType: object.contentType,
    fileName: object.key.split("/").pop() ?? object.key,
    // Chunked encryption metadata (undefined for legacy single-blob files)
    chunkSize: object.chunkSize,
    chunkCount: object.chunkCount,
    chunkIvs: object.chunkIvs, // JSON string, parse on client
  });
}

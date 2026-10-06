import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import ShareLink from "@/models/ShareLink";
import StorageObject from "@/models/StorageObject";
import Bucket from "@/models/Bucket";
import { getSignedFileUrl, fileUrlLifetime } from "@/lib/b2/cdn";
import { verifySharePassword } from "@/lib/share/password-protection";
import { Space } from "@xenode/database/models";

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
 */
export async function POST(req: NextRequest, { params }: Params) {
  const resolvedParams = await params;
  const body = await req.json().catch(() => ({}));
  const { password, itemId } = body;

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

  if (link.expiresAt && new Date() >= link.expiresAt)
    return NextResponse.json(
      { error: "This link has expired" },
      { status: 410 },
    );

  if (link.maxDownloads && link.downloadCount >= link.maxDownloads)
    return NextResponse.json(
      { error: "Download limit reached" },
      { status: 410 },
    );

  const passwordCheck = await verifySharePassword(link, password);
  if (!passwordCheck.ok) {
    return NextResponse.json(
      { error: passwordCheck.error },
      { status: passwordCheck.status },
    );
  }

  const selectedItem = link.isBundle
    ? itemId
      ? link.bundleItems?.find((item) => item.objectId.toString() === itemId)
      : link.bundleItems?.[0]
    : null;
  if (link.isBundle && !selectedItem) {
    return NextResponse.json({ error: "File not found in share" }, { status: 404 });
  }

  const objectId = selectedItem?.objectId || link.objectId;
  const object = await StorageObject.findOne({ _id: objectId, deletedAt: null, purgeState: { $exists: false } }).lean();
  if (!object || !await Space.exists({ _id: object.spaceId, status: "active" }))
    return NextResponse.json({ error: "File not found" }, { status: 404 });

  const bucket = await Bucket.findById(object.bucketId);
  if (!bucket)
    return NextResponse.json({ error: "Bucket not found" }, { status: 404 });

  let signedUrl = "";
  let chunkUrls: string[] | undefined = undefined;

  if (object.chunks && object.chunks.length > 0) {
    const sortedChunks = [...(object.chunks || [])].sort(
      (a, b) => a.index - b.index,
    );
    chunkUrls = await Promise.all(
      sortedChunks.map((chunk) =>
        getSignedFileUrl(bucket.b2BucketId, chunk.key, fileUrlLifetime(link.expiresAt)),
      ),
    );
  } else {
    // 1-hour signed URL — enough for a preview session
    signedUrl = await getSignedFileUrl(bucket.b2BucketId, object.key, fileUrlLifetime(link.expiresAt));
  }

  return NextResponse.json({
    // Content and file-key wraps are bound to this id.
    objectId: String(object._id),
    streamUrl: signedUrl || undefined,
    chunkUrls,
    isEncrypted: object.isEncrypted,
    iv: object.iv,
    contentType: selectedItem?.shareEncryptedContentType || link.shareEncryptedContentType || object.contentType,
    mediaCategory: object.mediaCategory,
    fileName: selectedItem?.shareEncryptedName || link.shareEncryptedName || (object.encryptedName || object.key.split("/").pop())!,
    shareEncryptedName: selectedItem?.shareEncryptedName || link.shareEncryptedName,
    shareEncryptedContentType: selectedItem?.shareEncryptedContentType || link.shareEncryptedContentType,
    shareEncryptedThumbnail: selectedItem?.shareEncryptedThumbnail || link.shareEncryptedThumbnail,
    shareEncryptedDEK: selectedItem?.shareEncryptedDEK || link.shareEncryptedDEK,
    shareKeyIv: selectedItem?.shareKeyIv || link.shareKeyIv,
    // Chunked encryption metadata (undefined for legacy single-blob files)
    chunkSize: object.chunkSize,
    chunkCount: object.chunkCount,
    chunkIvs: object.chunkIvs, // JSON string, parse on client
    thumbnail: selectedItem?.shareEncryptedThumbnail || link.shareEncryptedThumbnail || object.thumbnail,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

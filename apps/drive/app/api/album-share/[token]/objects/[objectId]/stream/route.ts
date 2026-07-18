import { NextRequest, NextResponse } from "next/server";

import dbConnect from "@/lib/mongodb";
import AlbumShareLink from "@/models/AlbumShareLink";
import StorageObject from "@/models/StorageObject";
import Bucket from "@/models/Bucket";
import { getSignedFileUrl } from "@/lib/b2/cdn";
import { verifyAlbumSharePassword } from "@/lib/share/album-password";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ token: string; objectId: string }>;
}

/**
 * POST /api/album-share/[token]/objects/[objectId]/stream
 *
 * Public — returns short-lived signed URLs to stream/decrypt a single photo in
 * a shared album. The per-photo wrapped DEK comes from the share link item; the
 * actual share key never reaches the server (it lives in the link fragment).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { token, objectId } = await params;
  const body = await req.json().catch(() => ({}));
  await dbConnect();

  const link = await AlbumShareLink.findOne({ token, isRevoked: false });
  if (!link) {
    return NextResponse.json(
      { error: "Link not found or revoked" },
      { status: 404 },
    );
  }

  if (link.expiresAt && new Date() > link.expiresAt) {
    return NextResponse.json({ error: "This link has expired" }, { status: 410 });
  }

  const passwordCheck = await verifyAlbumSharePassword(link, body.password);
  if (!passwordCheck.ok) {
    return NextResponse.json(
      { error: passwordCheck.error },
      { status: passwordCheck.status },
    );
  }

  const item = link.items.find((i) => String(i.objectId) === objectId);
  if (!item) {
    return NextResponse.json(
      { error: "Photo is not part of this shared album" },
      { status: 404 },
    );
  }

  const object = await StorageObject.findOne({
    _id: item.objectId,
    deletedAt: { $exists: false },
  }).lean();
  if (!object) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const bucket = await Bucket.findById(object.bucketId);
  if (!bucket) {
    return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
  }

  let streamUrl = "";
  let chunkUrls: string[] | undefined;

  if (object.chunks && object.chunks.length > 0) {
    const sortedChunks = [...object.chunks].sort((a, b) => a.index - b.index);
    chunkUrls = await Promise.all(
      sortedChunks.map((chunk) =>
        getSignedFileUrl(bucket.b2BucketId, chunk.key, 3600),
      ),
    );
  } else {
    streamUrl = await getSignedFileUrl(bucket.b2BucketId, object.key, 3600);
  }

  return NextResponse.json({
    streamUrl: streamUrl || undefined,
    url: streamUrl || undefined,
    chunkUrls,
    isEncrypted: object.isEncrypted,
    iv: object.iv,
    contentType: item.shareEncryptedContentType || object.contentType,
    mediaCategory: object.mediaCategory,
    shareEncryptedName: item.shareEncryptedName,
    shareEncryptedContentType: item.shareEncryptedContentType,
    shareEncryptedDEK: item.shareEncryptedDEK,
    shareKeyIv: item.shareKeyIv,
    chunkSize: object.chunkSize,
    chunkCount: object.chunkCount,
    chunkIvs: object.chunkIvs,
  });
}

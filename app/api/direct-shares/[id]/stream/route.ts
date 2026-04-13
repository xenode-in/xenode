import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import DirectShare from "@/models/DirectShare";
import StorageObject from "@/models/StorageObject";
import Bucket from "@/models/Bucket";
import { getSignedFileUrl } from "@/lib/b2/cdn";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth(request);
    const { id } = await params;
    await dbConnect();

    const share = await DirectShare.findOne({ _id: id, isRevoked: false });
    if (!share) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    const recipient = share.recipients.find(
      (item) => item.recipientUserId === session.user.id,
    );
    if (!recipient) {
      return NextResponse.json({ error: "You do not have access to this share" }, { status: 403 });
    }

    const object = await StorageObject.findById(share.objectId).lean();
    if (!object) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const bucket = await Bucket.findById(object.bucketId).lean();
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    let streamUrl = "";
    let chunkUrls: string[] | undefined;

    if (object.chunks && object.chunks.length > 0) {
      const sortedChunks = [...object.chunks].sort((a, b) => a.index - b.index);
      chunkUrls = await Promise.all(
        sortedChunks.map((chunk) => getSignedFileUrl(bucket.b2BucketId, chunk.key, 3600)),
      );
    } else {
      streamUrl = await getSignedFileUrl(bucket.b2BucketId, object.key, 3600);
    }

    await DirectShare.updateOne(
      { _id: share._id, "recipients.recipientUserId": session.user.id },
      { $set: { "recipients.$.lastAccessedAt": new Date() } },
    );

    return NextResponse.json({
      streamUrl: streamUrl || undefined,
      chunkUrls,
      isEncrypted: object.isEncrypted,
      iv: object.iv,
      contentType: share.shareEncryptedContentType || object.contentType,
      fileName: share.shareEncryptedName || object.encryptedName || object.key.split("/").pop(),
      shareEncryptedDEK: share.shareEncryptedDEK,
      shareKeyIv: share.shareKeyIv,
      shareEncryptedName: share.shareEncryptedName,
      shareEncryptedContentType: share.shareEncryptedContentType,
      shareEncryptedThumbnail: share.shareEncryptedThumbnail,
      chunkSize: object.chunkSize,
      chunkCount: object.chunkCount,
      chunkIvs: object.chunkIvs,
      thumbnail: share.shareEncryptedThumbnail || object.thumbnail,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

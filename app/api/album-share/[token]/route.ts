import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";

import dbConnect from "@/lib/mongodb";
import AlbumShareLink from "@/models/AlbumShareLink";
import StorageObject from "@/models/StorageObject";
import Bucket from "@/models/Bucket";
import { getSignedFileUrl } from "@/lib/b2/cdn";
import { verifyAlbumSharePassword } from "@/lib/share/album-password";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ token: string }>;
}

type LinkStatus =
  | { ok: true }
  | { ok: false; status: number; error: string };

function checkLinkValidity(link: {
  expiresAt?: Date;
  maxViews?: number;
  viewCount: number;
}): LinkStatus {
  if (link.expiresAt && new Date() > link.expiresAt) {
    return { ok: false, status: 410, error: "This link has expired" };
  }
  if (link.maxViews && link.viewCount >= link.maxViews) {
    return { ok: false, status: 410, error: "View limit reached" };
  }
  return { ok: true };
}

/** GET — public album-level metadata (no items, no decryption material). */
export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params;
  await dbConnect();

  const link = await AlbumShareLink.findOne({ token, isRevoked: false }).lean();
  if (!link) {
    return NextResponse.json(
      { error: "Link not found or revoked" },
      { status: 404 },
    );
  }

  const validity = checkLinkValidity(link);
  if (!validity.ok) {
    return NextResponse.json({ error: validity.error }, { status: validity.status });
  }

  return NextResponse.json({
    shareEncryptedAlbumName: link.shareEncryptedAlbumName ?? null,
    itemCount: link.items.length,
    isPasswordProtected: link.isPasswordProtected,
    expiresAt: link.expiresAt ?? null,
  });
}

/**
 * POST — unlock + fetch the full manifest. Verifies the password (when set),
 * counts the view against maxViews, and returns every photo's share-encrypted
 * metadata plus a signed thumbnail URL.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  await dbConnect();

  const link = await AlbumShareLink.findOne({ token, isRevoked: false });
  if (!link) {
    return NextResponse.json(
      { error: "Link not found or revoked" },
      { status: 404 },
    );
  }

  const validity = checkLinkValidity(link);
  if (!validity.ok) {
    return NextResponse.json({ error: validity.error }, { status: validity.status });
  }

  const passwordCheck = await verifyAlbumSharePassword(link, body.password);
  if (!passwordCheck.ok) {
    return NextResponse.json(
      { error: passwordCheck.error },
      { status: passwordCheck.status },
    );
  }

  // Count one view per successful unlock (non-blocking).
  AlbumShareLink.updateOne({ _id: link._id }, { $inc: { viewCount: 1 } }).exec();

  // Resolve the underlying objects (for size/aspect/category) and their buckets.
  const objectIds = link.items.map((item) => item.objectId);
  const objects = await StorageObject.find({
    _id: { $in: objectIds },
    deletedAt: { $exists: false },
  })
    .select(
      "_id size mediaCategory aspectRatio isEncrypted contentType bucketId",
    )
    .lean<
      Array<{
        _id: Types.ObjectId;
        size?: number;
        mediaCategory?: string;
        aspectRatio?: number;
        isEncrypted?: boolean;
        contentType?: string;
        bucketId: Types.ObjectId;
      }>
    >();
  const objectById = new Map(objects.map((o) => [String(o._id), o]));

  const bucketIds = Array.from(new Set(objects.map((o) => String(o.bucketId))));
  const buckets = await Bucket.find({ _id: { $in: bucketIds } })
    .select("_id b2BucketId")
    .lean<Array<{ _id: Types.ObjectId; b2BucketId: string }>>();
  const bucketById = new Map(buckets.map((b) => [String(b._id), b]));

  const items = await Promise.all(
    link.items.map(async (item) => {
      const obj = objectById.get(String(item.objectId));
      if (!obj) return null;
      const bucket = bucketById.get(String(obj.bucketId));

      let thumbnailUrl: string | null = null;
      if (item.shareEncryptedThumbnail && bucket) {
        try {
          thumbnailUrl = await getSignedFileUrl(
            bucket.b2BucketId,
            item.shareEncryptedThumbnail,
            3600,
          );
        } catch {
          thumbnailUrl = null;
        }
      }

      return {
        objectId: String(item.objectId),
        size: obj.size ?? 0,
        mediaCategory: obj.mediaCategory ?? "image",
        aspectRatio: obj.aspectRatio ?? 1,
        isEncrypted: !!obj.isEncrypted,
        contentType: obj.contentType ?? "application/octet-stream",
        shareEncryptedName: item.shareEncryptedName ?? null,
        shareEncryptedContentType: item.shareEncryptedContentType ?? null,
        shareEncryptedDEK: item.shareEncryptedDEK,
        shareKeyIv: item.shareKeyIv,
        thumbnailUrl,
      };
    }),
  );

  return NextResponse.json({
    shareEncryptedAlbumName: link.shareEncryptedAlbumName ?? null,
    items: items.filter(Boolean),
  });
}

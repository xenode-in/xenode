import Bucket, { type IBucket } from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import ShareLink from "@/models/ShareLink";
import DirectShare from "@/models/DirectShare";
import AlbumShareLink from "@/models/AlbumShareLink";
import type { Types } from "mongoose";

/**
 * Resolve the physical regional bucket that owns a public `shares/` thumbnail.
 * Share recipients may live in another region, so their session region cannot
 * be used to route these keys.
 */
export async function resolveShareKeyBucket(
  key: string,
): Promise<IBucket | null> {
  if (!key.startsWith("shares/")) return null;

  const [publicShare, directShare] = await Promise.all([
    ShareLink.findOne({
      $or: [
        { shareEncryptedThumbnail: key },
        { "bundleItems.shareEncryptedThumbnail": key },
      ],
      isRevoked: false,
    })
      .select("bucketId")
      .lean<{ bucketId: IBucket["_id"] } | null>(),
    DirectShare.findOne({
      shareEncryptedThumbnail: key,
      isRevoked: false,
    })
      .select("bucketId")
      .lean<{ bucketId: IBucket["_id"] } | null>(),
  ]);

  const directBucketId = publicShare?.bucketId ?? directShare?.bucketId;
  if (directBucketId) return Bucket.findById(directBucketId);

  const albumShare = await AlbumShareLink.findOne({
    "items.shareEncryptedThumbnail": key,
    isRevoked: false,
  })
    .select("items")
    .lean<{
      items: Array<{
        objectId: Types.ObjectId;
        shareEncryptedThumbnail?: string;
      }>;
    } | null>();
  const item = albumShare?.items.find(
    (candidate) => candidate.shareEncryptedThumbnail === key,
  );
  if (!item) return null;

  const object = await StorageObject.findById(item.objectId)
    .select("bucketId")
    .lean<{ bucketId: IBucket["_id"] } | null>();
  return object ? Bucket.findById(object.bucketId) : null;
}

import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import ShareLink from "@/models/ShareLink";
import DirectShare from "@/models/DirectShare";
import AlbumShareLink from "@/models/AlbumShareLink";
import { Space } from "@xenode/database/models";
import type { AccessContext } from "@/lib/authz";
import { bucketOwnershipClause, objectOwnershipClause } from "@/lib/authz";
import { fileUrlLifetime } from "@/lib/b2/cdn";

/** Key-only thumbnail access never bypasses a password, expiry or recipient gate. */
export async function resolveThumbnailAccess(key: string, ctx: AccessContext | null) {
  let objectId: unknown;
  let expiresAt: Date | undefined;
  if (key.startsWith("shares/")) {
    const publicLink = await ShareLink.findOne({
      isRevoked: false, isPasswordProtected: false,
      $or: [{ shareEncryptedThumbnail: key }, { "bundleItems.shareEncryptedThumbnail": key }],
    });
    if (publicLink && (!publicLink.maxDownloads || publicLink.downloadCount < publicLink.maxDownloads) &&
        (!publicLink.expiresAt || publicLink.expiresAt.getTime() > Date.now())) {
      objectId = publicLink.bundleItems?.find(item => item.shareEncryptedThumbnail === key)?.objectId ?? publicLink.objectId;
      expiresAt = publicLink.expiresAt;
    } else {
      const direct = ctx ? await DirectShare.findOne({ isRevoked: false, shareEncryptedThumbnail: key, "recipients.recipientUserId": ctx.accountId }) : null;
      if (direct) objectId = direct.objectId;
      else {
        const album = await AlbumShareLink.findOne({ isRevoked: false, isPasswordProtected: false, "items.shareEncryptedThumbnail": key });
        if (!album || (album.expiresAt && album.expiresAt.getTime() <= Date.now()) || (album.maxViews && album.viewCount >= album.maxViews)) return null;
        objectId = album.items.find(item => item.shareEncryptedThumbnail === key)?.objectId;
        expiresAt = album.expiresAt;
      }
    }
  } else if (!ctx) return null;
  const object = await StorageObject.findOne({
    ...(objectId ? { _id: objectId } : { thumbnail: key, ...objectOwnershipClause(ctx!) }),
    productId: "drive", deletedAt: null, purgeState: { $exists: false },
  }).select("bucketId spaceId").lean();
  if (!object || !await Space.exists({ _id: object.spaceId, status: "active" })) return null;
  const bucket = await Bucket.findOne({ _id: object.bucketId, ...(!key.startsWith("shares/") ? bucketOwnershipClause(ctx!) : {}) });
  if (!bucket) return null;
  const deadline = expiresAt && ctx?.session?.session.expiresAt ? new Date(Math.min(expiresAt.getTime(), ctx.session.session.expiresAt.getTime())) : expiresAt ?? ctx?.session?.session.expiresAt;
  return { bucket, expiresIn: fileUrlLifetime(deadline) };
}

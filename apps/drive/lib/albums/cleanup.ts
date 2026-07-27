import { Types } from "mongoose";

import PhotoAlbum from "@/models/PhotoAlbum";
import AlbumShareLink from "@/models/AlbumShareLink";
import type { IAlbumShareItem } from "@/models/AlbumShareLink";
import StorageObject from "@/models/StorageObject";
import Bucket from "@/models/Bucket";
import { deleteObjects as deleteB2Objects } from "@/lib/b2/objects";
import { resolveAccountStorageRegion } from "@/lib/storage/region";

/** Collect the `shares/` thumbnail keys from a set of share items. */
function thumbKeysOf(items: IAlbumShareItem[]): string[] {
  return items
    .map((i) => i.shareEncryptedThumbnail)
    .filter(
      (k): k is string => typeof k === "string" && k.startsWith("shares/"),
    );
}

/**
 * Resolve the b2 bucket name that a user's share thumbnails were uploaded to.
 * Thumbnails live alongside the photos, so we resolve from one of the photos;
 * if those are already gone, fall back to the user's own bucket.
 */
async function resolveUserB2Bucket(
  userId: string,
  hintObjectIds: Types.ObjectId[],
): Promise<string | null> {
  if (hintObjectIds.length > 0) {
    const obj = await StorageObject.findOne({ _id: { $in: hintObjectIds } })
      .select("bucketId")
      .lean<{ bucketId: Types.ObjectId } | null>();
    if (obj) {
      const bucket = await Bucket.findById(obj.bucketId)
        .select("b2BucketId")
        .lean<{ b2BucketId: string } | null>();
      if (bucket) return bucket.b2BucketId;
    }
  }
  const storageRegion = await resolveAccountStorageRegion(userId);
  const owned = await Bucket.findOne({ systemKey: "drive", storageRegion })
    .select("b2BucketId")
    .lean<{ b2BucketId: string } | null>();
  return owned?.b2BucketId ?? null;
}

/**
 * Best-effort deletion of the re-encrypted thumbnail blobs a set of album
 * shares uploaded to B2. Called when shares are revoked/replaced so they don't
 * orphan storage. Never throws — storage cleanup must not block the caller.
 */
export async function deleteAlbumShareThumbnails(
  userId: string,
  items: IAlbumShareItem[],
): Promise<void> {
  try {
    const keys = thumbKeysOf(items);
    if (keys.length === 0) return;
    const objectIds = items.map((i) => i.objectId);
    const b2Bucket = await resolveUserB2Bucket(userId, objectIds);
    if (!b2Bucket) return;
    await deleteB2Objects(b2Bucket, keys);
  } catch (e) {
    console.error("[album-share] thumbnail cleanup failed:", e);
  }
}

/**
 * Remove objects from a user's albums and album shares when those objects are
 * binned or purged. Keeps album photo counts/covers accurate and ensures a
 * public album link never serves a deleted photo.
 *
 * Restore intentionally does NOT re-add the photo to its albums (mirrors the
 * file-share behaviour where restore doesn't revive shares) — re-add manually.
 */
export async function removeObjectsFromAlbums(
  spaceId: string,
  actorAccountId: string,
  objectIds: Array<string | Types.ObjectId>,
): Promise<void> {
  const ids = objectIds
    .map((id) =>
      id instanceof Types.ObjectId
        ? id
        : Types.ObjectId.isValid(id)
          ? new Types.ObjectId(id)
          : null,
    )
    .filter((v): v is Types.ObjectId => v !== null);

  if (ids.length === 0) return;

  // Delete the B2 thumbnail blobs for the items we're about to drop from shares.
  const affectedLinks = await AlbumShareLink.find({
    createdBy: actorAccountId,
    "items.objectId": { $in: ids },
  })
    .select("items")
    .lean<Array<{ items: IAlbumShareItem[] }>>();
  const idSet = new Set(ids.map(String));
  const removedItems = affectedLinks
    .flatMap((l) => l.items)
    .filter((i) => idSet.has(String(i.objectId)));
  await deleteAlbumShareThumbnails(actorAccountId, removedItems);

  // 1. Drop the objects from every album that referenced them.
  await PhotoAlbum.updateMany(
    { spaceId, objectIds: { $in: ids } },
    { $pull: { objectIds: { $in: ids } } },
  );

  // 2. Repoint covers that pointed at a removed object to the first survivor
  //    (null when the album is now empty). Pipeline update so we can read the
  //    freshly-pulled objectIds array.
  await PhotoAlbum.updateMany(
    { spaceId, coverObjectId: { $in: ids } },
    [
      {
        $set: {
          coverObjectId: {
            $ifNull: [{ $arrayElemAt: ["$objectIds", 0] }, null],
          },
        },
      },
    ],
    { updatePipeline: true },
  );

  // 3. Drop the matching items from any active album share links.
  await AlbumShareLink.updateMany(
    { createdBy: actorAccountId, "items.objectId": { $in: ids } },
    { $pull: { items: { objectId: { $in: ids } } } },
  );

  // 4. Revoke album shares that are now empty.
  await AlbumShareLink.updateMany(
    { createdBy: actorAccountId, isRevoked: false, items: { $size: 0 } },
    { $set: { isRevoked: true } },
  );
}

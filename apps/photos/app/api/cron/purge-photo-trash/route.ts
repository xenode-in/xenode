import {
  PhotoAsset,
  connectDatabase,
  getDatabase,
  queuePhotoAssetPurge,
  cleanupStorageBinObject,
} from "@xenode/database";
import { deletePhotoCiphertext } from "@/lib/storage-delete";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  await connectDatabase();
  const now = new Date(),
    cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  let queued = 0,
    deleted = 0,
    retry = 0,
    blocked = 0;
  const expired = await PhotoAsset.find({
    status: "trashed",
    trashedAt: { $lte: cutoff },
    purgeRequestedAt: { $exists: false },
  })
    .sort({ trashedAt: 1 })
    .limit(100)
    .lean();
  for (const asset of expired) {
    try {
      queued += (
        await queuePhotoAssetPurge({
          accountId: asset.createdByAccountId,
          spaceId: asset.spaceId,
          assetIds: [asset.assetId],
        })
      ).queuedCount;
    } catch {
      retry++;
    }
  }
  const pending = await getDatabase()
    .collection("storageobjects")
    .find({
      productId: "photos",
      purgeState: "pending",
      purgeAfter: { $lte: now },
      $and: [
        {
          $or: [
            { purgeLeaseExpiresAt: { $exists: false } },
            { purgeLeaseExpiresAt: { $lte: now } },
          ],
        },
        {
          $or: [
            { purgeNextAttemptAt: { $exists: false } },
            { purgeNextAttemptAt: { $lte: now } },
          ],
        },
      ],
    })
    .sort({ deletedAt: 1, _id: 1 })
    .limit(100)
    .toArray();
  for (const object of pending) {
    const result = await cleanupStorageBinObject({
      productId: "photos",
      objectId: object._id,
      now,
      deleteBlobs: async (_bucket, keys) =>
        deletePhotoCiphertext(object.bucketId, keys),
    });
    if (result === "deleted") deleted++;
    else if (result === "retry") retry++;
    else if (result === "blocked") blocked++;
  }
  return Response.json(
    { queued, scanned: pending.length, deleted, retry, blocked },
    { status: retry ? 500 : 200, headers: { "Cache-Control": "no-store" } },
  );
}

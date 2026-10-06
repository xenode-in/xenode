import { Types } from "mongoose";
import { withTransaction, getDatabase } from "../connection";
import { PhotoAsset, Space } from "../models";
import { PhotoUploadCommitError } from "./photo-uploads";
import { queueStorageBinPurge } from "./drive-bin";

export interface PhotoLifecycleScope {
  accountId: string;
  spaceId: string;
  assetIds: string[];
}
function ids(input: PhotoLifecycleScope) {
  if (
    !Array.isArray(input.assetIds) ||
    input.assetIds.length < 1 ||
    input.assetIds.length > 100 ||
    input.assetIds.some(
      (id) => typeof id !== "string" || !id || id.length > 128,
    )
  )
    throw new PhotoUploadCommitError(
      400,
      "invalid_asset_ids",
      "Select 1 to 100 photo assets",
    );
  return [...new Set(input.assetIds)];
}
/** Photos metadata and the storage record change together; Bin remains charged. */
export function changePhotoTrash(
  input: PhotoLifecycleScope & { restore?: boolean; now?: Date },
) {
  const selectedIds = ids(input);
  return withTransaction(async (session) => {
    const space = await Space.updateOne(
      { _id: input.spaceId, status: "active" },
      { $inc: { storageFenceVersion: 1 } },
      { session },
    );
    if (space.matchedCount !== 1)
      throw new PhotoUploadCommitError(
        409,
        "space_unavailable",
        "Photo Space is unavailable",
      );
    const assets = await PhotoAsset.find({
      assetId: { $in: selectedIds },
      spaceId: input.spaceId,
      createdByAccountId: input.accountId,
    })
      .session(session)
      .lean();
    if (
      assets.length !== selectedIds.length ||
      assets.some((asset) => !Types.ObjectId.isValid(asset.storageObjectId))
    )
      throw new PhotoUploadCommitError(
        404,
        "asset_unavailable",
        "Photo asset is unavailable",
      );
    const objects = getDatabase().collection("storageobjects");
    const objectIds = assets.map(
      (asset) => new Types.ObjectId(asset.storageObjectId),
    );
    const records = await objects
      .find(
        {
          _id: { $in: objectIds },
          productId: "photos",
          spaceId: input.spaceId,
        },
        { session },
      )
      .toArray();
    if (records.length !== assets.length)
      throw new PhotoUploadCommitError(
        409,
        "asset_storage_mismatch",
        "Photo storage is unavailable",
      );
    if (
      input.restore &&
      (assets.some((asset) => asset.purgeRequestedAt) ||
        records.some((record) => record.purgeState))
    )
      throw new PhotoUploadCommitError(
        409,
        "purge_pending",
        "Permanent photo deletion has already started",
      );
    for (const asset of assets) {
      const object = records.find(
        (record) => String(record._id) === asset.storageObjectId,
      )!;
      if ((asset.status === "trashed") !== object.deletedAt instanceof Date)
        throw new PhotoUploadCommitError(
          409,
          "asset_storage_mismatch",
          "Photo lifecycle records disagree",
        );
    }
    const now = input.now ?? new Date();
    const changed = assets.filter(
      (asset) => asset.status === (input.restore ? "trashed" : "active"),
    );
    if (!changed.length) return { changedCount: 0 };
    const changedIds = changed.map(
      (asset) => new Types.ObjectId(asset.storageObjectId),
    );
    await objects.updateMany(
      { _id: { $in: changedIds }, productId: "photos", spaceId: input.spaceId },
      input.restore
        ? {
            $unset: { deletedAt: "" },
            $set: { updatedAt: now },
            $inc: { __v: 1 },
          }
        : { $set: { deletedAt: now, updatedAt: now }, $inc: { __v: 1 } },
      { session },
    );
    await PhotoAsset.updateMany(
      {
        _id: { $in: changed.map((asset) => asset._id) },
        spaceId: input.spaceId,
      },
      input.restore
        ? { $set: { status: "active" }, $unset: { trashedAt: "" } }
        : { $set: { status: "trashed", trashedAt: now } },
      { session },
    );
    return { changedCount: changed.length };
  });
}

/** Resolve exact asset identities before delegating to shared permanent purge. */
export async function queuePhotoAssetPurge(input: PhotoLifecycleScope) {
  const selectedIds = ids(input);
  const assets = await PhotoAsset.find({
    assetId: { $in: selectedIds },
    spaceId: input.spaceId,
    createdByAccountId: input.accountId,
    status: "trashed",
  }).lean();
  if (
    assets.length !== selectedIds.length ||
    assets.some((asset) => !Types.ObjectId.isValid(asset.storageObjectId))
  )
    throw new PhotoUploadCommitError(
      404,
      "asset_unavailable",
      "Trashed photo asset is unavailable",
    );
  const records = await getDatabase()
    .collection("storageobjects")
    .find({
      _id: {
        $in: assets.map((asset) => new Types.ObjectId(asset.storageObjectId)),
      },
      spaceId: input.spaceId,
      productId: "photos",
      deletedAt: { $type: "date" },
    })
    .toArray();
  if (
    records.length !== assets.length ||
    new Set(records.map((record) => String(record.bucketId))).size !== 1
  )
    throw new PhotoUploadCommitError(
      409,
      "asset_storage_mismatch",
      "Photo storage is unavailable",
    );
  const queued = await queueStorageBinPurge({
    productId: "photos",
    spaceId: input.spaceId,
    bucketId: records[0].bucketId,
    ids: records.map((record) => record._id),
    includeRelated: false,
  });
  return { queuedCount: queued.length };
}

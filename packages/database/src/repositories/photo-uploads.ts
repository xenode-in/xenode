import type { Types } from "mongoose";
import { getDatabase, withTransaction } from "../connection";
import { PhotoAsset, PhotoUpload } from "../models";

export class PhotoUploadCommitError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PhotoUploadCommitError";
  }
}

/** Atomically commit one verified Photos manifest and its byte accounting. */
export async function commitPhotoUpload(input: {
  uploadId: string;
  accountId: string;
  spaceId: string;
  bucketId: Types.ObjectId;
  storageObject: Record<string, unknown>;
  asset: {
    mediaType: "image" | "video";
    takenAt: Date;
    width?: number;
    height?: number;
  };
}) {
  try {
    return await withTransaction(async (session) => {
      const manifest = await PhotoUpload.findOne({
        uploadId: input.uploadId, accountId: input.accountId,
        spaceId: input.spaceId, bucketId: input.bucketId,
      }).session(session).lean();
      if (!manifest) {
        throw new PhotoUploadCommitError(409, "upload_manifest_missing", "Photo upload manifest is missing");
      }
      const existingAsset = await PhotoAsset.findOne({
        assetId: manifest.assetId, spaceId: input.spaceId,
        createdByAccountId: input.accountId,
      }).session(session).lean();
      const objectId = manifest._id;
      if (manifest.status === "completed" &&
        existingAsset?.storageObjectId === objectId.toString()) {
        return { asset: existingAsset, created: false };
      }
      if (existingAsset || manifest.status !== "pending" || manifest.expiresAt <= new Date()) {
        throw new PhotoUploadCommitError(409, "upload_manifest_conflict", "Photo upload is no longer pending or its asset ID is already used");
      }
      if (
        input.storageObject.isEncrypted !== true ||
        input.storageObject.contentType !== "application/octet-stream" ||
        input.storageObject.wrappedBy !== "space" ||
        typeof input.storageObject.encryptedDEK !== "string" ||
        typeof input.storageObject.iv !== "string" ||
        typeof input.storageObject.spaceKeyWrapIv !== "string" ||
        input.asset.mediaType !== manifest.mediaType ||
        input.storageObject.key !== manifest.original.key ||
        input.storageObject.size !== manifest.original.size ||
        input.storageObject.optimizedKey !== manifest.optimized?.key ||
        input.storageObject.optimizedSize !== manifest.optimized?.size ||
        input.storageObject.thumbnail !== manifest.thumbnail?.key ||
        input.storageObject.thumbnailSize !== manifest.thumbnail?.size
      ) {
        throw new PhotoUploadCommitError(409, "upload_manifest_mismatch", "Verified metadata does not match the upload manifest");
      }
      const claimed = await PhotoUpload.updateOne(
        { _id: manifest._id, status: "pending" },
        { $set: { status: "completing" } },
        { session },
      );
      if (claimed.modifiedCount !== 1) {
        throw new PhotoUploadCommitError(409, "upload_manifest_conflict", "Photo upload was claimed by another operation");
      }
      const database = getDatabase();
      const usages = database.collection("usages");
      const usage = await usages.findOne({ userId: input.accountId }, { session });
      if (!usage || !Number.isFinite(usage.totalStorageBytes) || usage.totalStorageBytes < 0) {
        throw new PhotoUploadCommitError(409, "usage_not_initialized", "Storage usage is not initialized");
      }
      const totalBytes = manifest.original.size +
        (manifest.optimized?.size ?? 0) + (manifest.thumbnail?.size ?? 0);
      const quotaFilter = usage.storageLimitBytes === null
        ? { userId: input.accountId }
        : typeof usage.storageLimitBytes === "number" &&
          Number.isFinite(usage.storageLimitBytes) && usage.storageLimitBytes >= 0
          ? { userId: input.accountId, totalStorageBytes: { $lte: usage.storageLimitBytes - totalBytes } }
          : null;
      if (!quotaFilter) {
        throw new PhotoUploadCommitError(409, "usage_not_initialized", "Storage limit is not initialized");
      }
      const now = new Date();
      const reserved = await usages.findOneAndUpdate(quotaFilter, {
        $inc: { totalStorageBytes: totalBytes, totalObjects: 1, uploadCount: 1 },
        $set: { lastActiveAt: now, updatedAt: now },
      }, { session, returnDocument: "after" });
      if (!reserved) {
        throw new PhotoUploadCommitError(402, "storage_quota_exceeded", "Storage quota exceeded");
      }
      await database.collection("storageobjects").insertOne({
        ...input.storageObject,
        _id: objectId, productId: "photos", bucketId: manifest.bucketId,
        spaceId: input.spaceId, createdByAccountId: input.accountId,
        createdAt: now, updatedAt: now,
      }, { session });
      const [asset] = await PhotoAsset.create([{
        ...input.asset,
        assetId: manifest.assetId, spaceId: input.spaceId,
        storageObjectId: objectId.toString(), createdByAccountId: input.accountId,
        uploadSource: "web", status: "active",
      }], { session });
      const bucketUpdate = await database.collection("buckets").updateOne(
        { _id: manifest.bucketId },
        { $inc: { objectCount: 1, totalSizeBytes: totalBytes }, $set: { updatedAt: now } },
        { session },
      );
      if (bucketUpdate.matchedCount !== 1) {
        throw new PhotoUploadCommitError(409, "bucket_missing", "Regional bucket metadata is missing");
      }
      const completed = await PhotoUpload.updateOne(
        { _id: manifest._id, status: "completing" },
        { $set: { status: "completed" } },
        { session },
      );
      if (completed.modifiedCount !== 1) {
        throw new PhotoUploadCommitError(409, "upload_manifest_conflict", "Photo upload claim disappeared");
      }
      return { asset: asset.toObject(), created: true };
    });
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === 11000) {
      throw new PhotoUploadCommitError(409, "asset_id_conflict", "Photo upload identity is already used");
    }
    throw error;
  }
}

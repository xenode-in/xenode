import { randomUUID } from "node:crypto";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { PhotoUpload, findReferencedStorageObjectKeys } from "@xenode/database";
import { getPhotosStorageContext } from "@/lib/storage-server";

type CleanupResult =
  | { status: "deleted"; keyCount: number }
  | { status: "blocked" | "unavailable"; keyCount: 0 };

/** Shared by user abort and cron; caller text never determines physical keys. */
export async function cleanupPhotoUpload(params: {
  uploadId: string;
  accountId: string;
  spaceId: string;
  expiredAt?: Date;
}): Promise<CleanupResult> {
  const now = new Date();
  const manifest = await PhotoUpload.findOne({
    uploadId: params.uploadId,
    accountId: params.accountId,
    spaceId: params.spaceId,
    status: { $in: params.expiredAt
      ? ["pending", "aborting", "aborted"] : ["pending", "aborting"] },
    ...(params.expiredAt ? { expiresAt: { $lte: params.expiredAt } } : {}),
  }).lean();
  if (!manifest) return { status: "unavailable", keyCount: 0 };
  const storage = await getPhotosStorageContext(params.accountId);
  if (String(storage.bucket._id) !== String(manifest.bucketId)) {
    throw new Error("Upload bucket routing changed");
  }
  const leaseId = randomUUID();
  const claimed = await PhotoUpload.findOneAndUpdate(
    {
      _id: manifest._id,
      accountId: params.accountId,
      spaceId: params.spaceId,
      bucketId: manifest.bucketId,
      status: manifest.status,
      ...(params.expiredAt ? { expiresAt: { $lte: params.expiredAt } } : {}),
      $or: [
        { cleanupLeaseExpiresAt: { $exists: false } },
        { cleanupLeaseExpiresAt: { $lte: now } },
      ],
    },
    { $set: {
      status: "aborting", cleanupLeaseId: leaseId,
      cleanupLeaseExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    } },
    { returnDocument: "after" },
  );
  if (!claimed) return { status: "unavailable", keyCount: 0 };
  const leaseFilter = { _id: manifest._id, status: "aborting" as const, cleanupLeaseId: leaseId };
  const keys = [...new Set([
    manifest.original.key, manifest.optimized?.key, manifest.thumbnail?.key,
  ].filter((key): key is string => typeof key === "string"))];
  try {
    const referenced = await findReferencedStorageObjectKeys({
      bucketId: manifest.bucketId, keys,
    });
    if (referenced.size) {
      await PhotoUpload.updateOne(leaseFilter, {
        $set: { status: "blocked" },
        $unset: { cleanupLeaseId: 1, cleanupLeaseExpiresAt: 1 },
      });
      return { status: "blocked", keyCount: 0 };
    }
    const result = await storage.client.send(new DeleteObjectsCommand({
      Bucket: storage.bucket.b2BucketId,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }));
    if (result.Errors?.length) throw new Error("Blob deletion was incomplete");
    const completed = await PhotoUpload.updateOne(leaseFilter, {
      $set: { status: "aborted" },
      $unset: { cleanupLeaseId: 1, cleanupLeaseExpiresAt: 1 },
    });
    if (completed.modifiedCount !== 1) throw new Error("Cleanup lease was lost");
    if (params.expiredAt) {
      await PhotoUpload.deleteOne({
        _id: manifest._id, status: "aborted", expiresAt: { $lte: params.expiredAt },
      });
    }
    return { status: "deleted", keyCount: keys.length };
  } catch (error) {
    await PhotoUpload.updateOne(leaseFilter, {
      $unset: { cleanupLeaseId: 1, cleanupLeaseExpiresAt: 1 },
    }).catch(() => undefined);
    throw error;
  }
}

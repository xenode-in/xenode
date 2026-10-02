import { DeleteObjectsCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { cleanupPhotoUploadRecord } from "@xenode/database";
import { getPhotosStorageContext } from "@/lib/storage-server";

/** Photos storage adapter; the database repository owns expiry, claims and retirement. */
export async function cleanupPhotoUpload(params: {
  uploadId: string; accountId: string; spaceId: string; expiredAt?: Date; now?: Date;
}) {
  return cleanupPhotoUploadRecord({
    ...params,
    async deleteBlobs({ accountId, bucketId, keys }) {
      const storage = await getPhotosStorageContext(accountId);
      if (String(storage.bucket._id) !== String(bucketId)) throw new Error("Upload bucket routing changed");
      const deleted = await storage.client.send(new DeleteObjectsCommand({
        Bucket: storage.bucket.b2BucketId,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }));
      if (deleted.Errors?.length) throw new Error("Blob deletion was incomplete");
      for (const key of keys) {
        try {
          await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket.b2BucketId, Key: key }));
        } catch (error) {
          const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } };
          if (failure?.$metadata?.httpStatusCode === 404 || failure?.name === "NotFound" || failure?.name === "NoSuchKey") continue;
          throw error;
        }
        throw new Error("Storage deletion is unconfirmed");
      }
    },
  });
}

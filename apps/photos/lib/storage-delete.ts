import { DeleteObjectsCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getDatabase } from "@xenode/database";
import {
  isStorageRegion,
  resolveRegionBucketConfig,
} from "@xenode/config/storage";
import { getPhotosS3Client } from "./storage-server";
/** Cleanup uses immutable bucket routing even after the owning account retires. */
export async function deletePhotoCiphertext(bucketId: unknown, keys: string[]) {
  const bucket = await getDatabase()
    .collection("buckets")
    .findOne({ _id: bucketId as import("mongoose").Types.ObjectId });
  if (
    !bucket ||
    !isStorageRegion(bucket.storageRegion) ||
    resolveRegionBucketConfig(bucket.storageRegion).bucketName !==
      bucket.b2BucketId
  )
    throw new Error("Photo bucket routing unavailable");
  const client = getPhotosS3Client(bucket.storageRegion);
  for (let start = 0; start < keys.length; start += 1000) {
    const batch = [...new Set(keys.slice(start, start + 1000))];
    const deleted = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket.b2BucketId,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    if (deleted.Errors?.length) throw new Error("Blob deletion was incomplete");
    for (const key of batch) {
      try {
        await client.send(
          new HeadObjectCommand({ Bucket: bucket.b2BucketId, Key: key }),
        );
      } catch (error) {
        const failure = error as {
          name?: string;
          $metadata?: { httpStatusCode?: number };
        };
        if (
          failure.name === "NotFound" ||
          failure.name === "NoSuchKey" ||
          failure.$metadata?.httpStatusCode === 404
        )
          continue;
        throw error;
      }
      throw new Error("Storage deletion is unconfirmed");
    }
  }
}

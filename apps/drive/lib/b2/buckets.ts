import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "./client";
import {
  regionForBucketName,
  type StorageRegion,
} from "@xenode/config/storage";

/**
 * Check if a bucket exists
 */
export async function bucketExists(
  bucketName: string,
  region: StorageRegion = regionForBucketName(bucketName),
): Promise<boolean> {
  try {
    const command = new HeadBucketCommand({ Bucket: bucketName });
    await getS3Client(region).send(command);
    return true;
  } catch {
    return false;
  }
}

import { CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "./client";
import {
  regionForBucketName,
  type StorageRegion,
} from "@xenode/config/storage";

/**
 * Create a new bucket in B2 via S3-compatible API
 * Bucket names in B2 must be globally unique
 */
export async function createB2Bucket(
  bucketName: string,
  region: StorageRegion = regionForBucketName(bucketName),
): Promise<string> {
  const command = new CreateBucketCommand({
    Bucket: bucketName,
  });

  const response = await getS3Client(region).send(command);

  return response.Location || bucketName;
}

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

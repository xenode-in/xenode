import {
  CreateBucketCommand,
  DeleteBucketCommand,
  ListBucketsCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getS3Client } from "./client";
import {
  DEFAULT_STORAGE_REGION,
  regionForBucketName,
  type StorageRegion,
} from "@xenode/config/storage";

export interface B2BucketInfo {
  name: string;
  creationDate?: Date;
}

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
 * Delete a bucket from B2
 * Bucket must be empty before deletion
 */
export async function deleteB2Bucket(bucketName: string): Promise<void> {
  const command = new DeleteBucketCommand({
    Bucket: bucketName,
  });

  await getS3Client(regionForBucketName(bucketName)).send(command);
}

/**
 * List all buckets in the B2 account
 */
export async function listB2Buckets(): Promise<B2BucketInfo[]> {
  const command = new ListBucketsCommand({});
  const response = await getS3Client(DEFAULT_STORAGE_REGION).send(command);

  return (response.Buckets || []).map((bucket) => ({
    name: bucket.Name || "",
    creationDate: bucket.CreationDate,
  }));
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

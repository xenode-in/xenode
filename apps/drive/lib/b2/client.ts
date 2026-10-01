import { S3Client } from "@aws-sdk/client-s3";
import {
  DEFAULT_STORAGE_REGION,
  requireRegionBucketCredentials,
  resolveRegionBucketConfig,
  type StorageRegion,
} from "@xenode/config/storage";
import { getActiveRegion } from "@/lib/storage/region-context";

const _clientsByRegion = new Map<StorageRegion, S3Client>();

/**
 * Get or create the S3 client for R2.
 * Uses lazy initialization to prevent build-time crashes
 */
/**
 * Get or create the S3 client for a storage region (default: asia). One cached
 * client per region so a US/EU account's objects use that region's endpoint +
 * credentials. Existing callers that pass nothing keep the default-region
 * behavior.
 */
export function getS3Client(
  region: StorageRegion = getActiveRegion(),
): S3Client {
  const cached = _clientsByRegion.get(region);
  if (cached) return cached;

  const storage = resolveRegionBucketConfig(region);
  const credentials = requireRegionBucketCredentials(region);

  const client = new S3Client({
    endpoint: storage.endpoint,
    region: storage.region,
    // Fresh, mutable credentials copy — the AWS SDK mutates the object it gets.
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
    forcePathStyle: true,
  });
  _clientsByRegion.set(region, client);
  return client;
}

/**
 * Public assets use a bucket in the same R2 account as the default region.
 */
export function getPublicS3Client(): S3Client {
  return getS3Client(DEFAULT_STORAGE_REGION);
}

export const getB2Region = (region: StorageRegion = getActiveRegion()) =>
  resolveRegionBucketConfig(region).region;
export const getB2Endpoint = (region: StorageRegion = getActiveRegion()) =>
  resolveRegionBucketConfig(region).endpoint;

import { S3Client } from "@aws-sdk/client-s3";
import {
  DEFAULT_STORAGE_REGION,
  isStorageRegion,
  requireRegionBucketCredentials,
  resolveRegionBucketConfig,
  type StorageRegion,
} from "@xenode/config/storage";
import {
  AccountProfile,
  connectDatabase,
  getDatabase,
} from "@xenode/database";

const clients = new Map<StorageRegion, S3Client>();

export function getPhotosS3Client(region: StorageRegion): S3Client {
  const existing = clients.get(region);
  if (existing) return existing;
  const config = resolveRegionBucketConfig(region);
  const credentials = requireRegionBucketCredentials(region);
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
    forcePathStyle: true,
  });
  clients.set(region, client);
  return client;
}

export async function getPhotosStorageContext(accountId: string) {
  await connectDatabase();
  const profile = await AccountProfile.findOne({ accountId })
    .select("storageRegion")
    .lean();
  const storageRegion = isStorageRegion(profile?.storageRegion)
    ? profile.storageRegion
    : DEFAULT_STORAGE_REGION;
  const config = resolveRegionBucketConfig(storageRegion);
  const bucket = await getDatabase().collection("buckets").findOne({
    systemKey: "drive",
    storageRegion,
    b2BucketId: config.bucketName,
  });
  if (!bucket) {
    throw new Error(
      `Regional bucket metadata is missing for ${storageRegion}; run the regional bucket migration`,
    );
  }
  return {
    bucket: {
      _id: bucket._id,
      b2BucketId: config.bucketName,
    },
    client: getPhotosS3Client(storageRegion),
    storageRegion,
  };
}

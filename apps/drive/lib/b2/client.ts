import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import https from "https";
import {
  requireRegionBucketCredentials,
  resolveRegionBucketConfig,
  type StorageRegion,
} from "@xenode/config/storage";
import { getActiveRegion } from "@/lib/storage/region-context";

const _clientsByRegion = new Map<StorageRegion, S3Client>();
let _publicClient: S3Client | null = null;

/**
 * Persistent HTTPS agent shared across all B2 requests.
 * keepAlive=true reuses TCP connections instead of opening a new socket per
 * request — critical for the thumbnail proxy and batch upload paths where
 * many small S3 calls fire in quick succession.
 */
const _httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });
const _requestHandler = new NodeHttpHandler({ httpsAgent: _httpsAgent });

/**
 * Get or create the S3 client for B2
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
    // requestHandler: _requestHandler,
  });
  _clientsByRegion.set(region, client);
  return client;
}

/**
 * Get the public S3 client (Zata.ai)
 */
export function getPublicS3Client(): S3Client {
  if (!_publicClient) {
    const PUBLIC_ENDPOINT =
      process.env.PUBLIC_S3_ENDPOINT || "https://idr01.zata.ai";
    const S3_REGION = process.env.S3_REGION || "us-west-004";
    const S3_KEY_ID = process.env.S3_KEY_ID;
    const S3_APPLICATION_KEY = process.env.S3_APPLICATION_KEY;

    if (!S3_KEY_ID || !S3_APPLICATION_KEY) {
      throw new Error(
        "S3_KEY_ID and S3_APPLICATION_KEY environment variables are required",
      );
    }

    _publicClient = new S3Client({
      endpoint: PUBLIC_ENDPOINT,
      region: S3_REGION,
      credentials: {
        accessKeyId: S3_KEY_ID.trim(),
        secretAccessKey: S3_APPLICATION_KEY.trim(),
      },
      forcePathStyle: true,
      // requestHandler: _requestHandler,
    });
  }
  return _publicClient;
}

export const getB2Region = (region: StorageRegion = getActiveRegion()) =>
  resolveRegionBucketConfig(region).region;
export const getB2Endpoint = (region: StorageRegion = getActiveRegion()) =>
  resolveRegionBucketConfig(region).endpoint;

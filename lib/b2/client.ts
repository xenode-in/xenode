import { S3Client } from "@aws-sdk/client-s3";

let _client: S3Client | null = null;
let _publicClient: S3Client | null = null;

/**
 * Get or create the S3 client for B2
 * Uses lazy initialization to prevent build-time crashes
 */
export function getS3Client(): S3Client {
  if (!_client) {
    const S3_ENDPOINT =
      process.env.S3_ENDPOINT || "https://s3.us-west-004.backblazeb2.com";
    const S3_REGION = process.env.S3_REGION || "us-west-004";
    const S3_KEY_ID = process.env.S3_KEY_ID;
    const S3_APPLICATION_KEY = process.env.S3_APPLICATION_KEY;

    if (!S3_KEY_ID || !S3_APPLICATION_KEY) {
      throw new Error(
        "S3_KEY_ID and S3_APPLICATION_KEY environment variables are required",
      );
    }

    const keyId = S3_KEY_ID.trim();
    const appKey = S3_APPLICATION_KEY.trim();

    console.log(`[B2] Initializing S3 Client with:`);
    console.log(`[B2] Endpoint: ${S3_ENDPOINT}`);
    console.log(`[B2] Region: ${S3_REGION}`);
    console.log(`[B2] Key ID Length: ${keyId.length}`);
    console.log(`[B2] App Key Length: ${appKey.length}`);

    _client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      credentials: {
        accessKeyId: keyId,
        secretAccessKey: appKey,
      },
      forcePathStyle: true,
    });
  }

  return _client;
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
    });
  }
  return _publicClient;
}

export const getB2Region = () => process.env.S3_REGION || "us-west-004";
export const getB2Endpoint = () =>
  process.env.S3_ENDPOINT || "https://s3.us-west-004.backblazeb2.com";

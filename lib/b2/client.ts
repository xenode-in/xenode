import { S3Client } from "@aws-sdk/client-s3";

let _client: S3Client | null = null;

/**
 * Get or create the S3 client for B2
 * Uses lazy initialization to prevent build-time crashes
 */
export function getS3Client(): S3Client {
  if (!_client) {
    const B2_ENDPOINT =
      process.env.B2_ENDPOINT || "https://s3.us-west-004.backblazeb2.com";
    const B2_REGION = process.env.B2_REGION || "us-west-004";
    const B2_KEY_ID = process.env.B2_KEY_ID;
    const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY;

    if (!B2_KEY_ID || !B2_APPLICATION_KEY) {
      throw new Error(
        "B2_KEY_ID and B2_APPLICATION_KEY environment variables are required",
      );
    }

    const keyId = B2_KEY_ID.trim();
    const appKey = B2_APPLICATION_KEY.trim();

    console.log(`[B2] Initializing S3 Client with:`);
    console.log(`[B2] Endpoint: ${B2_ENDPOINT}`);
    console.log(`[B2] Region: ${B2_REGION}`);
    console.log(`[B2] Key ID Length: ${keyId.length}`);
    console.log(`[B2] App Key Length: ${appKey.length}`);

    _client = new S3Client({
      endpoint: B2_ENDPOINT,
      region: B2_REGION,
      credentials: {
        accessKeyId: keyId,
        secretAccessKey: appKey,
      },
      forcePathStyle: true,
    });
  }

  return _client;
}

export const getB2Region = () => process.env.B2_REGION || "us-west-004";
export const getB2Endpoint = () => process.env.B2_ENDPOINT || "https://s3.us-west-004.backblazeb2.com";

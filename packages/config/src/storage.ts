import { z } from "zod";

const storageEnvSchema = z.object({
  S3_BUCKET_NAME: z.string().trim().min(3).default("xenode-drive-storage"),
  S3_ENDPOINT: z
    .url()
    .default("https://s3.us-west-004.backblazeb2.com"),
  S3_REGION: z.string().trim().min(1).default("us-west-004"),
  S3_KEY_ID: z.string().trim().min(1).optional(),
  S3_APPLICATION_KEY: z.string().trim().min(1).optional(),
});

export interface SystemBucketConfig {
  bucketName: string;
  endpoint: string;
  region: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

let cachedStorageConfig: SystemBucketConfig | undefined;

export function resolveSystemBucketConfig(
  env: Record<string, string | undefined> = process.env,
): SystemBucketConfig {
  if (env === process.env && cachedStorageConfig) return cachedStorageConfig;

  const parsed = storageEnvSchema.parse(env);
  if (
    (parsed.S3_KEY_ID && !parsed.S3_APPLICATION_KEY) ||
    (!parsed.S3_KEY_ID && parsed.S3_APPLICATION_KEY)
  ) {
    throw new Error("S3_KEY_ID and S3_APPLICATION_KEY must be configured together");
  }

  const config: SystemBucketConfig = Object.freeze({
    bucketName: parsed.S3_BUCKET_NAME,
    endpoint: parsed.S3_ENDPOINT,
    region: parsed.S3_REGION,
    credentials:
      parsed.S3_KEY_ID && parsed.S3_APPLICATION_KEY
        ? Object.freeze({
            accessKeyId: parsed.S3_KEY_ID,
            secretAccessKey: parsed.S3_APPLICATION_KEY,
          })
        : undefined,
  });

  if (env === process.env) cachedStorageConfig = config;
  return config;
}

export function requireSystemBucketCredentials(
  config = resolveSystemBucketConfig(),
): NonNullable<SystemBucketConfig["credentials"]> {
  if (!config.credentials) {
    throw new Error(
      "S3_KEY_ID and S3_APPLICATION_KEY are required for storage access",
    );
  }
  return config.credentials;
}

export function clearStorageConfigCacheForTests(): void {
  cachedStorageConfig = undefined;
}

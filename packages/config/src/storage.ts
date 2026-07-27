import { z } from "zod";

/**
 * Multi-region storage configuration.
 *
 * Each region maps to its own S3-compatible bucket + credentials, selected from
 * environment variables by a per-region prefix:
 *
 *   asia (default) → S3_BUCKET_NAME / S3_ENDPOINT / S3_REGION / S3_KEY_ID / S3_APPLICATION_KEY
 *   us             → S3_US_BUCKET_NAME / S3_US_ENDPOINT / S3_US_REGION / S3_US_KEY_ID / S3_US_APPLICATION_KEY
 *   eu             → S3_EU_BUCKET_NAME / S3_EU_ENDPOINT / S3_EU_REGION / S3_EU_KEY_ID / S3_EU_APPLICATION_KEY
 *
 * Asia keeps the unprefixed names for backward compatibility. A region whose
 * env is unset resolves to defaults with no credentials — it only errors when a
 * caller actually tries to use it (requireRegionBucketCredentials).
 */

export const STORAGE_REGIONS = ["asia", "us", "eu"] as const;
export type StorageRegion = (typeof STORAGE_REGIONS)[number];

export const DEFAULT_STORAGE_REGION: StorageRegion = "asia";

/** Human-facing labels for the onboarding region picker. */
export const STORAGE_REGION_LABELS: Record<StorageRegion, string> = {
  asia: "Asia",
  us: "United States",
  eu: "Europe",
};

export function isStorageRegion(value: unknown): value is StorageRegion {
  return (
    typeof value === "string" &&
    (STORAGE_REGIONS as readonly string[]).includes(value)
  );
}

const REGION_ENV_PREFIX: Record<StorageRegion, string> = {
  asia: "S3_",
  us: "S3_US_",
  eu: "S3_EU_",
};

const storageEnvSchema = z.object({
  S3_BUCKET_NAME: z.string().trim().min(3).default("xenode-drive-storage"),
  S3_ENDPOINT: z.url().default("https://s3.us-west-004.backblazeb2.com"),
  S3_REGION: z.string().trim().min(1).default("us-west-004"),
  S3_KEY_ID: z.string().trim().min(1).optional(),
  S3_APPLICATION_KEY: z.string().trim().min(1).optional(),
});

export interface SystemBucketConfig {
  region: string;
  bucketName: string;
  endpoint: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

/** Pull the five storage vars for a region, treating empty strings as unset. */
function envForRegion(
  region: StorageRegion,
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const prefix = REGION_ENV_PREFIX[region];
  const pick = (name: string) => {
    const value = env[`${prefix}${name}`];
    return value && value.trim() !== "" ? value : undefined;
  };
  return {
    S3_BUCKET_NAME: pick("BUCKET_NAME"),
    S3_ENDPOINT: pick("ENDPOINT"),
    S3_REGION: pick("REGION"),
    S3_KEY_ID: pick("KEY_ID"),
    S3_APPLICATION_KEY: pick("APPLICATION_KEY"),
  };
}

const cachedByRegion = new Map<StorageRegion, SystemBucketConfig>();

/** Resolve the bucket config for a specific storage region. */
export function resolveRegionBucketConfig(
  region: StorageRegion,
  env: Record<string, string | undefined> = process.env,
): SystemBucketConfig {
  const useCache = env === process.env;
  if (useCache) {
    const hit = cachedByRegion.get(region);
    if (hit) return hit;
  }

  const parsed = storageEnvSchema.parse(envForRegion(region, env));
  if (
    (parsed.S3_KEY_ID && !parsed.S3_APPLICATION_KEY) ||
    (!parsed.S3_KEY_ID && parsed.S3_APPLICATION_KEY)
  ) {
    throw new Error(
      `S3 key id and application key must be configured together for region "${region}"`,
    );
  }

  const config: SystemBucketConfig = {
    region: parsed.S3_REGION,
    bucketName: parsed.S3_BUCKET_NAME,
    endpoint: parsed.S3_ENDPOINT,
    // NOT frozen: the AWS SDK mutates the credentials object it receives.
    credentials:
      parsed.S3_KEY_ID && parsed.S3_APPLICATION_KEY
        ? {
            accessKeyId: parsed.S3_KEY_ID,
            secretAccessKey: parsed.S3_APPLICATION_KEY,
          }
        : undefined,
  };

  if (useCache) cachedByRegion.set(region, config);
  return config;
}

/**
 * Backward-compatible default-region resolver. Existing callers that don't know
 * the region get the default (asia) bucket. Accepts an explicit env for tests.
 */
export function resolveSystemBucketConfig(
  env: Record<string, string | undefined> = process.env,
): SystemBucketConfig {
  return resolveRegionBucketConfig(DEFAULT_STORAGE_REGION, env);
}

/**
 * Reverse-lookup the region that owns a physical bucket name. Used by token-
 * served download routes that have no session context but carry the bucket name
 * in the signed URL. Falls back to the default region.
 */
export function regionForBucketName(
  bucketName: string,
  env: Record<string, string | undefined> = process.env,
): StorageRegion {
  for (const region of STORAGE_REGIONS) {
    if (resolveRegionBucketConfig(region, env).bucketName === bucketName) {
      return region;
    }
  }
  return DEFAULT_STORAGE_REGION;
}

export function requireRegionBucketCredentials(
  region: StorageRegion,
  env: Record<string, string | undefined> = process.env,
): NonNullable<SystemBucketConfig["credentials"]> {
  const config = resolveRegionBucketConfig(region, env);
  if (!config.credentials) {
    throw new Error(
      `S3 credentials are not configured for region "${region}" (set ${REGION_ENV_PREFIX[region]}KEY_ID and ${REGION_ENV_PREFIX[region]}APPLICATION_KEY)`,
    );
  }
  return config.credentials;
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
  cachedByRegion.clear();
}

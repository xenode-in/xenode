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
 * The default pool uses unprefixed names. Enabled pools are declared without
 * credentials so Accounts can advertise the same choices as the products.
 */

export const STORAGE_REGIONS = ["asia", "us", "eu"] as const;
export type StorageRegion = (typeof STORAGE_REGIONS)[number];

export const DEFAULT_STORAGE_REGION: StorageRegion = "asia";

/** Human-facing labels for the onboarding region picker. */
export const STORAGE_REGION_LABELS: Record<StorageRegion, string> = {
  asia: "Default storage",
  us: "United States",
  eu: "European Union",
};

/** Non-secret deployment contract shared by Accounts, Drive and Photos. */
export function enabledStorageRegions(env: Record<string, string | undefined> = process.env): StorageRegion[] {
  const values = (env.STORAGE_ENABLED_REGIONS ?? "asia").split(",").map((value) => value.trim());
  if (!values.length || values.some((value) => !isStorageRegion(value)) ||
    new Set(values).size !== values.length || !values.includes(DEFAULT_STORAGE_REGION)) {
    throw new Error("STORAGE_ENABLED_REGIONS must list unique supported pools including asia");
  }
  return values as StorageRegion[];
}

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
  S3_BUCKET_NAME: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().trim().min(1).default("auto"),
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
  if (!isStorageRegion(region) || !enabledStorageRegions(env).includes(region)) {
    throw new Error(`Storage pool "${region}" is not enabled`);
  }
  const useCache = env === process.env;
  if (useCache) {
    const hit = cachedByRegion.get(region);
    if (hit) return hit;
  }

  const values = envForRegion(region, env);
  if (!values.S3_BUCKET_NAME || !values.S3_ENDPOINT) {
    throw new Error(`${REGION_ENV_PREFIX[region]}BUCKET_NAME and ${REGION_ENV_PREFIX[region]}ENDPOINT are required for storage pool "${region}"`);
  }
  const parsed = storageEnvSchema.parse(values);
  {
    const endpoint = new URL(parsed.S3_ENDPOINT);
    if (endpoint.protocol !== "https:" ||
      !/^[a-z0-9-]+\.(?:(?:eu|us)\.)?r2\.cloudflarestorage\.com$/u.test(endpoint.hostname) ||
      endpoint.username || endpoint.password || endpoint.port ||
      endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
      throw new Error(`Region "${region}" requires a Cloudflare R2 S3 endpoint`);
    }
    if ((region === "us" || region === "eu") &&
      !endpoint.hostname.endsWith(`.${region}.r2.cloudflarestorage.com`)) {
      throw new Error(`Storage pool "${region}" requires its R2 ${region} jurisdiction endpoint`);
    }
  }
  if (parsed.S3_REGION !== "auto") {
    throw new Error(`Region "${region}" must use the R2 S3 signing region "auto"`);
  }
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
    endpoint: new URL(parsed.S3_ENDPOINT).origin,
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
 * Explicitly resolve the deployment's default pool (also used by public assets).
 */
export function resolveSystemBucketConfig(
  env: Record<string, string | undefined> = process.env,
): SystemBucketConfig {
  return resolveRegionBucketConfig(DEFAULT_STORAGE_REGION, env);
}

/**
 * Reverse-lookup the region that owns a physical bucket name. Used by token-
 * served download routes that have no session context but carry the bucket name
 * in the signed URL. Unknown or ambiguous names must never select a pool.
 */
export function regionForBucketName(
  bucketName: string,
  env: Record<string, string | undefined> = process.env,
): StorageRegion {
  const matches: StorageRegion[] = [];
  for (const region of enabledStorageRegions(env)) {
    if (resolveRegionBucketConfig(region, env).bucketName === bucketName) {
      matches.push(region);
    }
  }
  if (matches.length !== 1) throw new Error("Physical storage bucket is unknown or ambiguous");
  return matches[0];
}

/** Runtime-only: reject incomplete, undeclared or ambiguous provisioning. */
export function validateStorageDeployment(env: Record<string, string | undefined> = process.env): Map<StorageRegion, SystemBucketConfig> {
  const enabled = enabledStorageRegions(env);
  const configs = new Map<StorageRegion, SystemBucketConfig>();
  const bucketNames = new Set<string>();
  for (const region of STORAGE_REGIONS) {
    const values = envForRegion(region, env);
    if (!enabled.includes(region)) {
      if (Object.values(values).some((value) => value !== undefined)) {
        throw new Error(`Storage pool "${region}" is configured but not declared in STORAGE_ENABLED_REGIONS`);
      }
      continue;
    }
    const config = resolveRegionBucketConfig(region, env);
    requireRegionBucketCredentials(region, env);
    if (bucketNames.has(config.bucketName)) throw new Error("Enabled storage pools must have distinct bucket names");
    bucketNames.add(config.bucketName);
    configs.set(region, config);
  }
  return configs;
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
  if (!config.endpoint) throw new Error(`R2 S3 endpoint is not configured for region "${region}"`);
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
  if (!config.endpoint) throw new Error("S3_ENDPOINT is required for R2 storage access");
  return config.credentials;
}

export function clearStorageConfigCacheForTests(): void {
  cachedByRegion.clear();
}

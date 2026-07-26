import { AsyncLocalStorage } from "node:async_hooks";
import {
  DEFAULT_STORAGE_REGION,
  resolveRegionBucketConfig,
  type StorageRegion,
} from "@xenode/config/storage";

/**
 * Request-scoped storage region.
 *
 * Set once per authenticated request (in getAccessContext) from the caller's
 * immutable region, then read implicitly by getS3Client() and
 * activeStorageBucketName() so every S3 operation in that request targets the
 * right regional bucket — without threading `region` through every call site.
 * Defaults to the default region (asia) when unset, so unauthenticated /
 * background paths keep their current behavior.
 */
const regionStore = new AsyncLocalStorage<StorageRegion>();

/** Bind the active region for the remainder of the current async context. */
export function setActiveRegion(region: StorageRegion): void {
  regionStore.enterWith(region);
}

/** Run a function with an explicit active region (for background jobs). */
export function runWithRegion<T>(region: StorageRegion, fn: () => T): T {
  return regionStore.run(region, fn);
}

export function getActiveRegion(): StorageRegion {
  return regionStore.getStore() ?? DEFAULT_STORAGE_REGION;
}

/** Physical bucket name for the active region (what S3 commands address). */
export function activeStorageBucketName(): string {
  return resolveRegionBucketConfig(getActiveRegion()).bucketName;
}

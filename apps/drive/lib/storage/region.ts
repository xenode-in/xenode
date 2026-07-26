import { AccountProfile } from "@xenode/database";
import {
  DEFAULT_STORAGE_REGION,
  isStorageRegion,
  type StorageRegion,
} from "@xenode/config/storage";

/**
 * Resolve the immutable storage region an account chose at onboarding. Falls
 * back to the default region for accounts created before regions existed (their
 * data lives in the default/asia bucket). Assumes the DB is already connected.
 */
export async function resolveAccountStorageRegion(
  accountId: string,
): Promise<StorageRegion> {
  const profile = await AccountProfile.findOne({ accountId })
    .select("storageRegion")
    .lean();
  return isStorageRegion(profile?.storageRegion)
    ? profile.storageRegion
    : DEFAULT_STORAGE_REGION;
}

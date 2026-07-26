import { AccountProfile } from "@xenode/database";
import {
  DEFAULT_STORAGE_REGION,
  isStorageRegion,
  type StorageRegion,
} from "@xenode/config/storage";
import OrgUsage from "@/models/OrgUsage";

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

/** Storage region for an organization's space (default region until assigned). */
export async function resolveOrgStorageRegion(
  orgId: string,
): Promise<StorageRegion> {
  const usage = await OrgUsage.findOne({ orgId }).select("storageRegion").lean();
  return isStorageRegion(usage?.storageRegion)
    ? usage.storageRegion
    : DEFAULT_STORAGE_REGION;
}

/**
 * Resolve the storage region for an access context: personal spaces use the
 * account's region; organization/team spaces use the org's region.
 */
export async function resolveContextStorageRegion(ctx: {
  userId: string;
  spaceType: string;
  organizationId?: string;
}): Promise<StorageRegion> {
  if (ctx.spaceType !== "personal" && ctx.organizationId) {
    return resolveOrgStorageRegion(ctx.organizationId);
  }
  return resolveAccountStorageRegion(ctx.userId);
}

import { AccountProfile } from "@xenode/database";
import {
  DEFAULT_STORAGE_REGION,
  isStorageRegion,
  type StorageRegion,
} from "@xenode/config/storage";
import OrgUsage from "@/models/OrgUsage";

/**
 * Resolve the selected pool. Unassigned owners use the explicit default pool;
 * corrupt or unsupported stored values must never silently change routing.
 */
export async function resolveAccountStorageRegion(
  accountId: string,
): Promise<StorageRegion> {
  const profile = await AccountProfile.findOne({ accountId })
    .select("storageRegion")
    .lean();
  if (profile?.storageRegion == null) return DEFAULT_STORAGE_REGION;
  if (!isStorageRegion(profile.storageRegion)) throw new Error("Account storage pool is invalid");
  return profile.storageRegion;
}

/** Storage region for an organization's space (default region until assigned). */
export async function resolveOrgStorageRegion(
  orgId: string,
): Promise<StorageRegion> {
  const usage = await OrgUsage.findOne({ orgId }).select("storageRegion").lean();
  if (usage?.storageRegion == null) return DEFAULT_STORAGE_REGION;
  if (!isStorageRegion(usage.storageRegion)) throw new Error("Organization storage pool is invalid");
  return usage.storageRegion;
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

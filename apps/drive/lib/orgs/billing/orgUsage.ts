import dbConnect from "@/lib/mongodb";
import { AuthzError } from "@/lib/authz";
import OrgUsage, {
  ORG_FREE_SEATS,
  ORG_FREE_TIER_LIMIT_BYTES,
} from "@/models/OrgUsage";
import { orgStorageOwnerId } from "@/lib/orgs/storage";
import type { StorageRegion } from "@xenode/config/storage";

/**
 * Org storage metering — the organization analogue of `lib/metering/usage.ts`,
 * keyed by `orgId` against `OrgUsage`. Enforces the org storage ceiling
 * atomically at upload time. BILLING_SECURITY: bytes only, no keys/metadata.
 */

export async function getOrCreateOrgUsage(
  orgId: string,
  storageRegion?: StorageRegion,
) {
  await dbConnect();
  return OrgUsage.findOneAndUpdate(
    { orgId },
    {
      $setOnInsert: {
        orgId,
        accountId: orgStorageOwnerId(orgId),
        plan: "org-free",
        storageLimitBytes: ORG_FREE_TIER_LIMIT_BYTES,
        seats: ORG_FREE_SEATS,
        ...(storageRegion ? { storageRegion } : {}),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

/** Throw 402 if adding `sizeBytes` would exceed the org ceiling (pre-check). */
export async function assertOrgStorageHeadroom(orgId: string, sizeBytes: number) {
  const usage = await getOrCreateOrgUsage(orgId);
  if (usage.storageLimitBytes !== null) {
    const projected = (usage.totalStorageBytes || 0) + sizeBytes;
    if (projected > usage.storageLimitBytes) {
      throw new AuthzError(
        402,
        "org_storage_quota_exceeded",
        "Organization storage limit reached",
      );
    }
  }
  return usage;
}

/** Atomically increment org storage, enforcing the ceiling in the same write. */
export async function incrementOrgStorage(orgId: string, sizeBytes: number) {
  await dbConnect();
  const usage = await getOrCreateOrgUsage(orgId);
  const filter =
    usage.storageLimitBytes === null || sizeBytes <= 0
      ? { orgId }
      : {
          orgId,
          totalStorageBytes: { $lte: usage.storageLimitBytes - sizeBytes },
        };
  const updated = await OrgUsage.findOneAndUpdate(
    filter,
    { $inc: { totalStorageBytes: sizeBytes, totalObjects: 1 } },
    { new: true },
  );
  if (!updated) {
    throw new AuthzError(
      402,
      "org_storage_quota_exceeded",
      "Organization storage limit reached",
    );
  }
  return updated;
}

/** Adjust org storage for an overwrite (positive deltas enforce the ceiling). */
export async function adjustOrgStorage(orgId: string, sizeDelta: number) {
  await dbConnect();
  if (sizeDelta === 0) return OrgUsage.findOne({ orgId });
  const usage = await getOrCreateOrgUsage(orgId);
  const filter =
    sizeDelta <= 0 || usage.storageLimitBytes === null
      ? { orgId }
      : {
          orgId,
          totalStorageBytes: { $lte: usage.storageLimitBytes - sizeDelta },
        };
  const updated = await OrgUsage.findOneAndUpdate(
    filter,
    { $inc: { totalStorageBytes: sizeDelta } },
    { new: true },
  );
  if (!updated) {
    throw new AuthzError(
      402,
      "org_storage_quota_exceeded",
      "Organization storage limit reached",
    );
  }
  return updated;
}

export async function decrementOrgStorage(
  orgId: string,
  sizeBytes: number,
  objectDelta = 1,
) {
  await dbConnect();
  return OrgUsage.findOneAndUpdate(
    { orgId },
    { $inc: { totalStorageBytes: -sizeBytes, totalObjects: -objectDelta } },
    { new: true },
  );
}

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

import dbConnect from "@/lib/mongodb";
import OrgUsage, {
  ORG_FREE_SEATS,
  ORG_FREE_TIER_LIMIT_BYTES,
} from "@/models/OrgUsage";
import { orgStorageOwnerId } from "@/lib/orgs/storage";
import type { StorageRegion } from "@xenode/config/storage";

/**
 * Org storage metering — the organization analogue of `lib/metering/usage.ts`,
 * keyed by `orgId` against `OrgUsage`. Byte counters change only inside the
 * shared storage transactions in `@xenode/database`.
 * BILLING_SECURITY: bytes only, no keys/metadata.
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

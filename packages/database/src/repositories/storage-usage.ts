import { getDatabase, withTransaction } from "../connection";
import { Space } from "../models";
import { storageObjectTotalBytes, type StorageByteSummary } from "./storage-objects";

export const USAGE_RECONCILIATION_OBJECT_LIMIT = 100_000;
export type StorageUsageOwner = { type: "personal" | "organization"; id: string };
export interface StorageUsageTotals { totalStorageBytes: number; totalObjects: number }
export interface StorageUsageReconciliation {
  owner: StorageUsageOwner;
  checkedAt: Date;
  spaceCount: number;
  status: "matched" | "drift" | "missing_usage" | "invalid_data" | "scan_limit";
  recorded: StorageUsageTotals | null;
  computed: StorageUsageTotals | null;
  difference: StorageUsageTotals | null;
  invalidObjects: number;
  invalidUsage: boolean;
}

const validBytes = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

function validSummary(object: StorageByteSummary): boolean {
  if (!validBytes(object.size) ||
    (object.thumbnailSize !== undefined && object.thumbnailSize !== null && !validBytes(object.thumbnailSize)) ||
    (object.optimizedSize !== undefined && object.optimizedSize !== null && !validBytes(object.optimizedSize)) ||
    (object.versions !== undefined && object.versions !== null && !Array.isArray(object.versions))) return false;
  return (object.versions ?? []).every((version) => {
    if (!version || typeof version !== "object" ||
      (version.sharesCurrentContent !== undefined && version.sharesCurrentContent !== null && typeof version.sharesCurrentContent !== "boolean") ||
      (version.chunks !== undefined && version.chunks !== null && !Array.isArray(version.chunks))) return false;
    if (version.sharesCurrentContent) return true;
    return version.chunks?.length
      ? version.chunks.every((chunk) => chunk && validBytes(chunk.size))
      : validBytes(version.size);
  });
}

/**
 * Compare counters to retained metadata in one read-only snapshot. Only byte
 * fields are projected; no keys, names, envelopes, plans or storage calls.
 * Bin/pending-deletion objects remain charged until their metadata is retired.
 * Upload reservations have not been committed and are not charged.
 */
export async function getStorageUsageReconciliation(owner: StorageUsageOwner): Promise<StorageUsageReconciliation> {
  if ((owner.type !== "personal" && owner.type !== "organization") ||
    typeof owner.id !== "string" || !owner.id || owner.id.length > 128) {
    throw new Error("A valid storage usage owner is required");
  }
  return withTransaction(async (session) => {
    const spaces = await Space.find(owner.type === "personal"
      ? { type: "personal", ownerAccountId: owner.id }
      : { type: { $in: ["organization", "team"] }, organizationId: owner.id })
      .select("_id").session(session).lean();
    const database = getDatabase();
    const usage = await database.collection(owner.type === "personal" ? "usages" : "orgusages").findOne(
      owner.type === "personal" ? { userId: owner.id } : { orgId: owner.id },
      { session, projection: { _id: 0, totalStorageBytes: 1, totalObjects: 1 } },
    );
    const invalidUsage = Boolean(usage && (!validBytes(usage.totalStorageBytes) || !validBytes(usage.totalObjects)));
    const recorded = usage && !invalidUsage
      ? { totalStorageBytes: usage.totalStorageBytes as number, totalObjects: usage.totalObjects as number }
      : null;
    const cursor = database.collection<StorageByteSummary & { productId?: string; validStructure: boolean }>("storageobjects").find(
      { spaceId: { $in: spaces.map((space) => space._id) } },
      { session, projection: {
        _id: 0, productId: 1, size: 1, thumbnailSize: 1, optimizedSize: 1,
        "versions.size": 1, "versions.sharesCurrentContent": 1, "versions.chunks.size": 1,
        // Dotted projections discard malformed scalar parents. Preserve their
        // shape as a boolean without retrieving version keys or envelopes.
        validStructure: { $and: [
          { $in: [{ $type: "$versions" }, ["missing", "null", "array"]] },
          { $allElementsTrue: [{ $map: {
            input: { $cond: [{ $isArray: "$versions" }, "$versions", []] }, as: "version",
            in: { $and: [
              { $eq: [{ $type: "$$version" }, "object"] },
              { $in: [{ $type: "$$version.chunks" }, ["missing", "null", "array"]] },
              { $allElementsTrue: [{ $map: {
                input: { $cond: [{ $isArray: "$$version.chunks" }, "$$version.chunks", []] },
                as: "chunk", in: { $eq: [{ $type: "$$chunk" }, "object"] },
              } }] },
            ] },
          } }] },
        ] },
      } },
    ).limit(USAGE_RECONCILIATION_OBJECT_LIMIT + 1).batchSize(500);
    const totals = { totalStorageBytes: 0, totalObjects: 0 };
    let invalidObjects = 0;
    let scanLimit = false;
    try {
      for await (const object of cursor) {
        if (totals.totalObjects === USAGE_RECONCILIATION_OBJECT_LIMIT) { scanLimit = true; break; }
        totals.totalObjects += 1;
        if (!object.validStructure || (object.productId !== "drive" && object.productId !== "photos") || !validSummary(object)) {
          invalidObjects += 1;
          continue;
        }
        const bytes = storageObjectTotalBytes(object);
        if (!validBytes(bytes) || !validBytes(totals.totalStorageBytes + bytes)) {
          invalidObjects += 1;
          continue;
        }
        totals.totalStorageBytes += bytes;
      }
    } finally {
      await cursor.close();
    }
    const computed = invalidObjects || scanLimit ? null : totals;
    const difference = computed && recorded ? {
      totalStorageBytes: computed.totalStorageBytes - recorded.totalStorageBytes,
      totalObjects: computed.totalObjects - recorded.totalObjects,
    } : null;
    const status = scanLimit ? "scan_limit" : invalidObjects || invalidUsage ? "invalid_data"
      : !usage ? "missing_usage" : difference?.totalStorageBytes || difference?.totalObjects ? "drift" : "matched";
    return { owner, checkedAt: new Date(), spaceCount: spaces.length, status,
      recorded, computed, difference, invalidObjects, invalidUsage };
  });
}

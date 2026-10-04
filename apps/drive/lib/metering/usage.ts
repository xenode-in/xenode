import dbConnect from "@/lib/mongodb";
import StorageObject from "@/models/StorageObject";
import { personalSpaceId } from "@xenode/spaces/ids";

/**
 * Usage byte counters are written only by the shared storage transactions in
 * `@xenode/database` (upload/revision finalization, version cleanup and Bin
 * purge), and plan state only by `syncUserSubscriptionState`. This module
 * reads; it never mutates Usage.
 */

/**
 * Recompute a personal Space's physical bytes from its objects, using the same
 * definition as finalization and purge: current content plus derivatives, plus
 * retained versions that do not share current content, across both products.
 * Read-only — a reconciliation report must never overwrite the counters that
 * concurrent transactions maintain.
 */
export async function computePersonalUsageTotals(userId: string): Promise<{
  totalStorageBytes: number;
  totalObjects: number;
}> {
  await dbConnect();
  const spaceId = personalSpaceId(userId);
  const [storageAgg, totalObjects] = await Promise.all([
    StorageObject.aggregate([
      { $match: { spaceId } },
      {
        $group: {
          _id: null,
          // Current content bytes.
          currentSize: { $sum: { $add: [
            { $ifNull: ["$size", 0] },
            { $ifNull: ["$thumbnailSize", 0] },
            { $ifNull: ["$optimizedSize", 0] },
          ] } },
          // Retained version bytes — chunk blobs when chunked, else the entry
          // size. Skip originals sharing current content so they count once.
          versionSize: {
            $sum: {
              $reduce: {
                input: { $ifNull: ["$versions", []] },
                initialValue: 0,
                in: {
                  $add: [
                    "$$value",
                    {
                      $cond: [
                        { $eq: ["$$this.sharesCurrentContent", true] },
                        0,
                        {
                          $cond: [
                            { $gt: [{ $size: { $ifNull: ["$$this.chunks", []] } }, 0] },
                            { $sum: "$$this.chunks.size" },
                            { $ifNull: ["$$this.size", 0] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      },
    ]),
    StorageObject.countDocuments({
      spaceId,
      productId: { $in: ["drive", "photos"] },
    }),
  ]);
  return {
    totalStorageBytes:
      (storageAgg[0]?.currentSize || 0) + (storageAgg[0]?.versionSize || 0),
    totalObjects,
  };
}

export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export function bytesToGB(bytes: number): number {
  return Number((bytes / (1024 * 1024 * 1024)).toFixed(2));
}

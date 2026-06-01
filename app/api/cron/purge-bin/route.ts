/**
 * GET /api/cron/purge-bin
 *
 * Permanently removes everything that has sat in the Bin for more than 30 days.
 * For each expired object it deletes the encrypted B2 blobs (main + thumbnail +
 * optimized, plus sidecars — they're soft-deleted alongside their parent),
 * hard-deletes the document, and frees the storage it occupied.
 *
 * Runs daily, secured with the shared CRON_SECRET (same pattern as
 * /api/cron/expire-plans). Register in vercel.json:
 *   { "crons": [{ "path": "/api/cron/purge-bin", "schedule": "0 1 * * *" }] }
 *
 * NOTE: this is the ONLY thing that purges binned items. The previous TTL index
 * on StorageObject.deletedAt was removed (it would drop the doc without deleting
 * the B2 blob); make sure this cron is actually scheduled in production.
 *
 * Processes in bounded batches so a large backlog can't blow up memory.
 */

import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import ShareLink from "@/models/ShareLink";
import DirectShare from "@/models/DirectShare";
import { deleteObjects as deleteB2Objects } from "@/lib/b2/objects";
import { decrementStorageBulk, updateBucketStats } from "@/lib/metering/usage";

export const dynamic = "force-dynamic";

const BIN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const BATCH = 500;
const MAX_BATCHES = 10000; // defensive ceiling; deleteMany guarantees progress

type ExpiredDoc = {
  _id: Types.ObjectId;
  bucketId: Types.ObjectId;
  userId: string;
  key?: string;
  thumbnail?: string;
  optimizedKey?: string;
  size?: number;
};

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await dbConnect();
    const now = new Date();
    const cutoff = new Date(now.getTime() - BIN_RETENTION_MS);

    let purgedCount = 0;

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const docs = await StorageObject.find({ deletedAt: { $lte: cutoff } })
        .select("_id bucketId userId key thumbnail optimizedKey size")
        .limit(BATCH)
        .lean<ExpiredDoc[]>();

      if (docs.length === 0) break;

      // Resolve b2BucketId for every bucket represented in this batch.
      const bucketIds = Array.from(
        new Set(docs.map((d) => d.bucketId.toString())),
      );
      const buckets = await Bucket.find({ _id: { $in: bucketIds } })
        .select("_id b2BucketId")
        .lean<{ _id: Types.ObjectId; b2BucketId: string }[]>();
      const b2ByBucket = new Map<string, string>();
      for (const b of buckets) b2ByBucket.set(b._id.toString(), b.b2BucketId);

      // Group B2 keys per physical bucket so we can batch-delete each.
      const keysByB2 = new Map<string, string[]>();
      // Aggregate metering deltas per user and per logical bucket.
      const userSize = new Map<string, number>();
      const userCount = new Map<string, number>();
      const bucketSize = new Map<string, number>();
      const bucketCount = new Map<string, number>();

      for (const d of docs) {
        const bid = d.bucketId.toString();
        const b2 = b2ByBucket.get(bid);
        if (b2) {
          const arr = keysByB2.get(b2) ?? [];
          if (d.key) arr.push(d.key);
          if (d.thumbnail && d.thumbnail.startsWith("users/"))
            arr.push(d.thumbnail);
          if (d.optimizedKey) arr.push(d.optimizedKey);
          keysByB2.set(b2, arr);
        }
        const sz = d.size || 0;
        userSize.set(d.userId, (userSize.get(d.userId) ?? 0) + sz);
        userCount.set(d.userId, (userCount.get(d.userId) ?? 0) + 1);
        bucketSize.set(bid, (bucketSize.get(bid) ?? 0) + sz);
        bucketCount.set(bid, (bucketCount.get(bid) ?? 0) + 1);
      }

      // 1. Blobs.
      for (const [b2, keys] of keysByB2) {
        await deleteB2Objects(b2, keys);
      }

      // 2. Documents.
      const ids = docs.map((d) => d._id);
      await StorageObject.deleteMany({ _id: { $in: ids } });
      await ShareLink.deleteMany({ objectId: { $in: ids } });
      await DirectShare.deleteMany({ objectId: { $in: ids } });

      // 3. Metering.
      for (const [uid, size] of userSize) {
        await decrementStorageBulk(uid, size, userCount.get(uid) ?? 0);
      }
      for (const [bid, size] of bucketSize) {
        await updateBucketStats(bid, -(bucketCount.get(bid) ?? 0), -size);
      }

      purgedCount += docs.length;

      // Last (partial) page — nothing left to scan.
      if (docs.length < BATCH) break;
    }

    return NextResponse.json({
      success: true,
      purgedCount,
      cutoff: cutoff.toISOString(),
      processedAt: now.toISOString(),
    });
  } catch (error) {
    console.error("[Cron] purge-bin error:", error);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}

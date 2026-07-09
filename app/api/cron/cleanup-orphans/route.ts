/**
 * GET /api/cron/cleanup-orphans
 *
 * Reclaims orphaned B2 blobs left by uploads that were abandoned before
 * `complete-upload` (tab closed, device locked past the resume window, crash,
 * a corrupted large video, etc.). Because bytes are PUT straight to B2 before
 * any StorageObject exists, such uploads leave `-chunk-N` / `-thumb` / main /
 * optimized objects with nothing referencing them.
 *
 * Driven by the UploadSession ledger (written at presign time, flipped to
 * `completed` at complete-upload). For every session still `pending` past its
 * `expiresAt` (24h — safely beyond the 1h presign window and any real upload),
 * this deletes its B2 keys and removes the row.
 *
 * Safety: a session whose logical key now belongs to a LIVE StorageObject
 * (upload actually finished but the ledger wasn't updated) is never deleted —
 * we drop the stale row and move on. Secured with the shared CRON_SECRET, same
 * pattern as /api/cron/purge-bin. Register in vercel.json / docker cron.
 *
 * Processes in bounded batches so a large backlog can't blow up memory.
 */

import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import UploadSession from "@/models/UploadSession";
import { deleteObjects as deleteB2Objects, listObjects } from "@/lib/b2/objects";

export const dynamic = "force-dynamic";

const BATCH = 500;
const MAX_BATCHES = 10000; // defensive ceiling; each batch deletes its rows so progress is guaranteed

type PendingSession = {
  _id: Types.ObjectId;
  bucketId: Types.ObjectId;
  fileId: string;
  keys: string[];
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

    let sessionsProcessed = 0;
    let keysDeleted = 0;
    let skippedLive = 0;

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const sessions = await UploadSession.find({
        status: "pending",
        expiresAt: { $lte: now },
      })
        .select("_id bucketId fileId keys")
        .limit(BATCH)
        .lean<PendingSession[]>();

      if (sessions.length === 0) break;

      // Resolve the physical B2 bucket for every bucket in this batch.
      const bucketIds = Array.from(
        new Set(sessions.map((s) => s.bucketId.toString())),
      );
      const buckets = await Bucket.find({ _id: { $in: bucketIds } })
        .select("_id b2BucketId")
        .lean<{ _id: Types.ObjectId; b2BucketId: string }[]>();
      const b2ByBucket = new Map<string, string>();
      for (const b of buckets) b2ByBucket.set(b._id.toString(), b.b2BucketId);

      const processedIds: Types.ObjectId[] = [];

      for (const s of sessions) {
        processedIds.push(s._id);
        const b2 = b2ByBucket.get(s.bucketId.toString());

        // Safety: if the upload actually completed (a live StorageObject owns
        // this logical key), never delete its blobs — just retire the stale row.
        const live = await StorageObject.findOne({
          bucketId: s.bucketId,
          key: s.fileId,
          deletedAt: { $exists: false },
        })
          .select("_id")
          .lean();
        if (live) {
          skippedLive++;
          continue;
        }

        if (!b2) continue; // bucket gone — drop the row, nothing to delete

        // Union the ledgered keys with whatever is actually under the prefix
        // (belt-and-suspenders for any key not recorded), then batch-delete.
        const keys = new Set<string>(s.keys ?? []);
        try {
          let continuationToken: string | undefined;
          do {
            const page = await listObjects(b2, s.fileId, 1000, continuationToken);
            for (const obj of page.objects) keys.add(obj.key);
            continuationToken = page.isTruncated
              ? page.nextContinuationToken
              : undefined;
          } while (continuationToken);
        } catch (err) {
          console.warn(`[Cron] cleanup-orphans list failed for ${s.fileId}:`, err);
        }

        const keyList = Array.from(keys).filter(Boolean);
        if (keyList.length > 0) {
          await deleteB2Objects(b2, keyList);
          keysDeleted += keyList.length;
        }
      }

      // Remove the processed session rows (both deleted and stale-live ones).
      await UploadSession.deleteMany({ _id: { $in: processedIds } });
      sessionsProcessed += sessions.length;

      if (sessions.length < BATCH) break;
    }

    return NextResponse.json({
      success: true,
      sessionsProcessed,
      keysDeleted,
      skippedLive,
      processedAt: now.toISOString(),
    });
  } catch (error) {
    console.error("[Cron] cleanup-orphans error:", error);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { cleanupDriveUpload, driveUploadCleanupFilter } from "@xenode/database";
import { resolveRegionBucketConfig } from "@xenode/config/storage";
import dbConnect from "@/lib/mongodb";
import UploadSession from "@/models/UploadSession";
import { deleteObjects } from "@/lib/b2/objects";

export const dynamic = "force-dynamic";
const BATCH = 100;

/** One bounded leased cleanup batch; confirmed B2 deletion precedes ledger removal. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await dbConnect();
    const now = new Date();
    const uploads = await UploadSession.find(driveUploadCleanupFilter(now))
      .sort({ expiresAt: 1, _id: 1 }).limit(BATCH).select("_id").lean();
    const counts = { scanned: uploads.length, deleted: 0, reconciled: 0, blocked: 0, skipped: 0, failed: 0, keysDeleted: 0 };
    for (const upload of uploads) {
      try {
        const result = await cleanupDriveUpload({
          sessionId: String(upload._id),
          deleteBlobs: async ({ bucketName, region, keys }) => {
            if (resolveRegionBucketConfig(region).bucketName !== bucketName) {
              throw new Error("Upload cleanup bucket routing changed");
            }
            await deleteObjects(bucketName, keys);
          },
        });
        if (result.status === "retry") counts.failed++;
        else counts[result.status]++;
        counts.keysDeleted += result.keyCount;
      } catch {
        counts.failed++;
      }
    }
    return NextResponse.json(counts, { status: counts.failed ? 500 : 200 });
  } catch (error) {
    console.error("Upload cleanup batch failed:", error);
    return NextResponse.json({ error: "Upload cleanup failed" }, { status: 500 });
  }
}

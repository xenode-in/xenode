import { PhotoUpload, connectDatabase } from "@xenode/database";
import { personalSpaceId } from "@xenode/spaces";
import { cleanupPhotoUpload } from "@/lib/upload-cleanup";

export const dynamic = "force-dynamic";

/** Confirm deletion before retiring expired Photos upload manifests. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await connectDatabase();
  const now = new Date();
  const uploads = await PhotoUpload.find({
    status: { $in: ["pending", "aborting", "aborted"] },
    expiresAt: { $lte: now },
  }).sort({ expiresAt: 1 }).limit(100).select("uploadId accountId spaceId").lean();
  let deleted = 0;
  let blocked = 0;
  let unavailable = 0;
  let failed = 0;
  for (const upload of uploads) {
    if (upload.spaceId !== personalSpaceId(upload.accountId)) {
      failed++;
      continue;
    }
    try {
      const result = await cleanupPhotoUpload({
        uploadId: upload.uploadId,
        accountId: upload.accountId,
        spaceId: upload.spaceId,
        expiredAt: now,
      });
      if (result.status === "deleted") deleted++;
      else if (result.status === "blocked") blocked++;
      else unavailable++;
    } catch {
      failed++;
    }
  }
  return Response.json(
    { scanned: uploads.length, deleted, blocked, unavailable, failed },
    { status: failed ? 500 : 200 },
  );
}

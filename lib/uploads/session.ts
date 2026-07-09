import type { Types } from "mongoose";
import UploadSession from "@/models/UploadSession";

/** How long an in-flight upload's B2 blobs are protected before the cleanup
 * cron may reclaim them. Must comfortably exceed the 1h presigned-URL window
 * plus any realistic upload/resume duration. */
export const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Record (or extend) the ledger row for an in-flight upload. Called from the
 * presign routes with the B2 keys they are about to hand out. Idempotent:
 * re-presigning the same `fileId` (e.g. on resume) refreshes the deadline and
 * unions in any new keys. Best-effort — never throw into the upload path.
 */
export async function recordUploadSession(params: {
  userId: string;
  bucketId: Types.ObjectId | string;
  fileId: string;
  keys: string[];
}): Promise<string | undefined> {
  try {
    const expiresAt = new Date(Date.now() + UPLOAD_SESSION_TTL_MS);
    const cleanKeys = Array.from(
      new Set(params.keys.filter((k): k is string => typeof k === "string" && !!k)),
    );
    const doc = await UploadSession.findOneAndUpdate(
      { bucketId: params.bucketId, fileId: params.fileId },
      {
        $set: { userId: params.userId, status: "pending", expiresAt },
        $addToSet: { keys: { $each: cleanKeys } },
      },
      { upsert: true, new: true },
    );
    return doc?._id?.toString();
  } catch (err) {
    console.warn("[uploads] recordUploadSession failed (non-fatal):", err);
    return undefined;
  }
}

/**
 * Flip the ledger row to `completed` once the StorageObject is persisted, so the
 * cleanup cron never touches a finished upload's blobs. Best-effort.
 */
export async function completeUploadSession(
  bucketId: Types.ObjectId | string,
  fileId: string,
): Promise<void> {
  try {
    await UploadSession.updateOne(
      { bucketId, fileId },
      { $set: { status: "completed" } },
    );
  } catch (err) {
    console.warn("[uploads] completeUploadSession failed (non-fatal):", err);
  }
}

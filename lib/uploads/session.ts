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
 * Attach a secondary blob (thumbnail / optimized preview) to its PARENT upload's
 * existing ledger row, so it is protected by the parent's completion and
 * reclaimed together with it if the upload is abandoned. Only attaches when a
 * session for `parentFileId` already exists AND belongs to `userId` — this both
 * prevents piggybacking onto another user's session in a shared bucket and works
 * for any key prefix (personal `users/…` or org `workspaces/…`). Returns the
 * parent session id on success, or undefined when there is no such owned session
 * (the caller should then record its own). Best-effort — never throws.
 */
export async function attachToUploadSession(params: {
  userId: string;
  bucketId: Types.ObjectId | string;
  parentFileId: string;
  key: string;
}): Promise<string | undefined> {
  try {
    // No upsert: match only an existing session owned by this user. Status is
    // left untouched so a parent already flipped to `completed` stays completed.
    const doc = await UploadSession.findOneAndUpdate(
      {
        bucketId: params.bucketId,
        fileId: params.parentFileId,
        userId: params.userId,
      },
      { $addToSet: { keys: params.key } },
      { new: true },
    );
    return doc?._id?.toString();
  } catch (err) {
    console.warn("[uploads] attachToUploadSession failed (non-fatal):", err);
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

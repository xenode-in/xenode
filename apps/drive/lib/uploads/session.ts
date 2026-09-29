import { Types } from "mongoose";
import UploadSession from "@/models/UploadSession";

/** How long an in-flight upload's B2 blobs are protected before the cleanup
 * cron may reclaim them. Must comfortably exceed the 1h presigned-URL window
 * plus any realistic upload/resume duration. */
export const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

let claimIndexPromise: Promise<void> | undefined;

/** Fail closed if an older development database still has a non-unique index. */
async function ensureClaimIndex(): Promise<void> {
  claimIndexPromise ??= UploadSession.collection
    .createIndex(
      { bucketId: 1, keys: 1 },
      { unique: true, name: "bucketId_1_keys_1" },
    )
    .then(() => undefined);
  await claimIndexPromise;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === 11000
  );
}

/** Resolve an upload identity from its reservation, never from caller key text. */
export async function findPendingUploadSession(params: {
  userId: string;
  spaceId: string;
  bucketId: Types.ObjectId | string;
  sessionId: string;
}) {
  if (!/^[0-9a-f]{24}$/iu.test(params.sessionId)) return null;
  return UploadSession.findOne({
    _id: params.sessionId,
    userId: params.userId,
    spaceId: params.spaceId,
    bucketId: params.bucketId,
    status: "pending",
    expiresAt: { $gt: new Date() },
  }).select("_id fileId keys").lean();
}

/** Reserve a new upload key, or renew only the exact pending reservation. */
export async function reserveUploadSession(params: {
  userId: string;
  spaceId: string;
  bucketId: Types.ObjectId | string;
  fileId: string;
  keys: string[];
  sessionId?: string;
}): Promise<string | null> {
  await ensureClaimIndex();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + UPLOAD_SESSION_TTL_MS);
  const keys = [...new Set(params.keys.filter(Boolean))];
  if (params.sessionId !== undefined && !Types.ObjectId.isValid(params.sessionId)) return null;
  const conflicting = await UploadSession.exists({
    bucketId: params.bucketId,
    keys: { $in: keys },
    ...(params.sessionId ? { _id: { $ne: params.sessionId } } : {}),
  });
  if (conflicting) return null;
  if (params.sessionId !== undefined) {
    try {
      const doc = await UploadSession.findOneAndUpdate(
        {
          _id: params.sessionId,
          bucketId: params.bucketId,
          fileId: params.fileId,
          userId: params.userId,
          spaceId: params.spaceId,
          status: "pending",
          expiresAt: { $gt: now },
        },
        { $set: { expiresAt }, $addToSet: { keys: { $each: keys } } },
        { returnDocument: "after" },
      );
      return doc?._id.toString() ?? null;
    } catch (error) {
      if (isDuplicateKeyError(error)) return null;
      throw error;
    }
  }
  try {
    const doc = await UploadSession.create({
      userId: params.userId,
      spaceId: params.spaceId,
      bucketId: params.bucketId,
      fileId: params.fileId,
      keys,
      status: "pending",
      expiresAt,
    });
    return doc._id.toString();
  } catch (error) {
    if (isDuplicateKeyError(error)) return null;
    throw error;
  }
}

/**
 * Attach a secondary blob (thumbnail / optimized preview) to its PARENT upload's
 * existing pending ledger row. The caller must present its reservation ID;
 * an object key and account alone do not authorize re-presigning.
 */
export async function attachToUploadSession(params: {
  userId: string;
  spaceId: string;
  bucketId: Types.ObjectId | string;
  parentFileId: string;
  parentSessionId: string;
  key: string;
}): Promise<string | null> {
  await ensureClaimIndex();
  if (!Types.ObjectId.isValid(params.parentSessionId)) return null;
  const conflicting = await UploadSession.exists({
    bucketId: params.bucketId,
    keys: params.key,
    _id: { $ne: params.parentSessionId },
  });
  if (conflicting) return null;
  try {
    const doc = await UploadSession.findOneAndUpdate(
      {
        _id: params.parentSessionId,
        bucketId: params.bucketId,
        fileId: params.parentFileId,
        userId: params.userId,
        spaceId: params.spaceId,
        status: "pending",
        expiresAt: { $gt: new Date() },
      },
      { $addToSet: { keys: params.key } },
      { returnDocument: "after" },
    );
    return doc?._id.toString() ?? null;
  } catch (error) {
    if (isDuplicateKeyError(error)) return null;
    throw error;
  }
}

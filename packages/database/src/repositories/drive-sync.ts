import { type ClientSession, Types, type mongo } from "mongoose";
import { getDatabase, withTransaction } from "../connection";
import { Space, DriveSyncTombstone } from "../models";
import { DRIVE_FOLDER_CONTENT_TYPE } from "./drive-folders";

export class DriveSyncError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message); this.name = "DriveSyncError";
  }
}

/** Space writes serialize cache-visible changes with transaction commit order. */
export async function nextDriveSyncVersion(spaceId: string, session: ClientSession, allowClosed = false): Promise<number> {
  const space = await Space.findOneAndUpdate({ _id: spaceId, ...(allowClosed ? {} : { status: "active" }),
    $or: [{ driveSyncVersion: { $exists: false } }, { driveSyncVersion: { $gte: 0, $lt: Number.MAX_SAFE_INTEGER } }],
  }, { $inc: { driveSyncVersion: 1 } }, { session, returnDocument: "after" }).lean();
  if (!space || !Number.isSafeInteger(space.driveSyncVersion)) throw new DriveSyncError(409, "sync_space_unavailable", "Space cannot accept cache changes");
  return space.driveSyncVersion!;
}
export async function stampDriveSyncObjects(spaceId: string, filter: mongo.Filter<mongo.Document>,
  session: ClientSession, allowClosed = false): Promise<number> {
  const syncVersion = await nextDriveSyncVersion(spaceId, session, allowClosed);
  await getDatabase().collection("storageobjects").updateMany(
    { ...filter, spaceId, productId: "drive", isSidecar: { $ne: true } }, { $set: { syncVersion } }, { session });
  return syncVersion;
}
export async function recordDriveSyncRemoval(spaceId: string, objectId: Types.ObjectId, session: ClientSession) {
  const syncVersion = await nextDriveSyncVersion(spaceId, session, true);
  await DriveSyncTombstone.updateOne({ _id: objectId },
    { $setOnInsert: { spaceId, syncVersion, deletedAt: new Date() } }, { upsert: true, session });
}

/** Client-sealed metadata (format 4, IV + tag); the server never sees plaintext. */
function isSealedMetadata(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4096) return false;
  const bytes = Buffer.from(value, "base64");
  return bytes.length >= 29 && bytes[0] === 4 && bytes.toString("base64") === value;
}

export async function updateDriveObjectMetadata(input: {
  spaceId: string; objectId: string; tags?: unknown; position?: unknown; starred?: unknown;
  /** Rename: the new name sealed for this object (a file name or a folder display name). */
  encryptedName?: unknown;
}) {
  if (!/^[a-f0-9]{24}$/iu.test(input.objectId)) throw new DriveSyncError(400, "invalid_object_id", "Invalid object id");
  const set: Record<string, unknown> = {};
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags) || input.tags.length > 100 || !input.tags.every(isSealedMetadata)) {
      throw new DriveSyncError(400, "invalid_encrypted_tags", "Tags must be sealed metadata");
    }
    set.tags = input.tags;
  }
  if (input.encryptedName !== undefined && !isSealedMetadata(input.encryptedName)) {
    throw new DriveSyncError(400, "invalid_encrypted_name", "Names must be sealed metadata");
  }
  if (input.position !== undefined) {
    if (!Number.isSafeInteger(input.position) || (input.position as number) < 0) throw new DriveSyncError(400, "invalid_position", "Invalid position");
    set.position = input.position;
  }
  if (input.starred !== undefined) {
    if (typeof input.starred !== "boolean") throw new DriveSyncError(400, "invalid_starred", "Invalid favourite flag");
    set.starred = input.starred;
  }
  if (!Object.keys(set).length && input.encryptedName === undefined) {
    throw new DriveSyncError(400, "empty_metadata_update", "No metadata changes");
  }
  const filter = {
    _id: new Types.ObjectId(input.objectId), spaceId: input.spaceId, productId: "drive",
    deletedAt: null, purgeState: { $exists: false },
  };
  return withTransaction(async (session) => {
    const objects = getDatabase().collection("storageobjects");
    if (input.encryptedName !== undefined) {
      const current = await objects.findOne(filter, { session, projection: { contentType: 1 } });
      if (!current) return null;
      set[current.contentType === DRIVE_FOLDER_CONTENT_TYPE ? "encryptedDisplayName" : "encryptedName"] = input.encryptedName;
    }
    const syncVersion = await nextDriveSyncVersion(input.spaceId, session);
    return objects.findOneAndUpdate(filter,
      { $set: { ...set, syncVersion, updatedAt: new Date() }, $inc: { __v: 1 } }, { session, returnDocument: "after" });
  });
}
export async function reorderDriveObjects(input: { spaceId: string; bucketId: Types.ObjectId; items: unknown }) {
  if (!Array.isArray(input.items) || input.items.length > 1000 || input.items.some((item) =>
    !item || typeof item.id !== "string" || !/^[a-f0-9]{24}$/iu.test(item.id) ||
    !Number.isSafeInteger(item.position) || item.position < 0)) throw new DriveSyncError(400, "invalid_reorder", "Invalid reorder batch");
  const items = input.items as Array<{ id: string; position: number }>;
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new DriveSyncError(400, "invalid_reorder", "Duplicate reorder ids");
  if (!items.length) return;
  return withTransaction(async (session) => {
    const syncVersion = await nextDriveSyncVersion(input.spaceId, session);
    for (const item of items) {
      const result = await getDatabase().collection("storageobjects").updateOne({
        _id: new Types.ObjectId(item.id), spaceId: input.spaceId, bucketId: input.bucketId,
        productId: "drive", deletedAt: null, purgeState: { $exists: false },
      }, { $set: { position: item.position, syncVersion, updatedAt: new Date() }, $inc: { __v: 1 } }, { session });
      if (result.matchedCount !== 1) throw new DriveSyncError(404, "object_missing", "Some reorder items are unavailable");
    }
  });
}

export interface DriveSyncCursor {
  version: 1;
  accountId: string;
  spaceId: string;
  mode: "snapshot" | "delta";
  bound: number;
  after: [number, string];
}
export interface DriveSyncChange {
  objectId: string;
  syncVersion: number;
  type: "upsert" | "remove";
  object?: Record<string, unknown>;
}
const FIELDS = ["_id", "key", "spaceId", "bucketId", "folderId", "ancestorIds", "size", "contentType", "encryptedContentType",
  "mediaCategory", "createdAt", "updatedAt", "isEncrypted", "encryptedName", "encryptedDisplayName", "tags",
  "thumbnail", "uploadSource", "syncContentFp", "wrappedBy", "spaceKeyVersion", "spaceKeyWrapIv",
  "optimizedKey", "optimizedEncryptedDEK", "optimizedSpaceKeyWrapIv", "optimizedIV", "optimizedSize",
  "aspectRatio", "position", "starred", "syncVersion"];
function validCursor(value: unknown, accountId: string, spaceId: string): value is DriveSyncCursor {
  if (!value || typeof value !== "object") return false;
  const cursor = value as DriveSyncCursor;
  return cursor.version === 1 && cursor.accountId === accountId && cursor.spaceId === spaceId &&
    ["snapshot", "delta"].includes(cursor.mode) && Number.isSafeInteger(cursor.bound) && cursor.bound >= 0 &&
    Array.isArray(cursor.after) && cursor.after.length === 2 && Number.isSafeInteger(cursor.after[0]) &&
    cursor.after[0] >= -1 && cursor.after[0] <= cursor.bound &&
    (cursor.after[1] === "" || /^[a-f0-9]{24}$/u.test(cursor.after[1]));
}
export function parseDriveSyncCursor(value: string | null, accountId: string, spaceId: string): DriveSyncCursor | null {
  if (value === null) return null;
  if (value.length > 2048) throw new DriveSyncError(400, "invalid_sync_cursor", "Invalid sync cursor");
  let cursor: unknown;
  try { cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); }
  catch { throw new DriveSyncError(400, "invalid_sync_cursor", "Invalid sync cursor"); }
  if (!validCursor(cursor, accountId, spaceId)) throw new DriveSyncError(400, "invalid_sync_cursor", "Sync cursor belongs to a different scope or format");
  return cursor;
}
export function encodeDriveSyncCursor(cursor: DriveSyncCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Current rows and durable removals, pinned to a visible transactional watermark. */
export async function readDriveSyncPage(input: { accountId: string; spaceId: string; cursor?: string | null; limit?: number }) {
  const previous = parseDriveSyncCursor(input.cursor ?? null, input.accountId, input.spaceId);
  const limit = input.limit ?? 500;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new DriveSyncError(400, "invalid_sync_limit", "Invalid sync page size");
  return withTransaction(async (session) => {
    const space = await Space.findOne({ _id: input.spaceId, status: "active" }).session(session).lean();
    const currentVersion = space?.driveSyncVersion ?? 0;
    if (!space || !Number.isSafeInteger(currentVersion)) throw new DriveSyncError(409, "sync_space_unavailable", "Sync Space is unavailable");
    if (previous && previous.bound > currentVersion) throw new DriveSyncError(409, "sync_reset_required", "Sync state must be reset");
    if (!previous && await getDatabase().collection("storageobjects").countDocuments({
      spaceId: input.spaceId, productId: "drive", isSidecar: { $ne: true },
      $or: [{ syncVersion: { $exists: false } }, { syncVersion: { $not: { $type: "number" } } },
        { syncVersion: { $lt: 0 } }, { syncVersion: { $gt: currentVersion } }],
    }, { session, limit: 1 })) throw new DriveSyncError(409, "sync_reset_required", "Reset obsolete development sync records");
    const bound = previous && previous.after[1] !== "" ? previous.bound : currentVersion;
    const after: [number, string] = previous?.after ?? [-1, ""];
    const cursor: DriveSyncCursor = { version: 1, accountId: input.accountId, spaceId: input.spaceId,
      mode: previous?.mode ?? "snapshot", bound, after };
    const newer = after[1] === ""
      ? { syncVersion: { $lte: bound, $gt: after[0] } }
      : { $or: [{ syncVersion: { $lte: bound, $gt: after[0] } },
          { syncVersion: after[0], _id: { $gt: new Types.ObjectId(after[1]) } }] };
    const objects = await getDatabase().collection("storageobjects").find({
      spaceId: input.spaceId, productId: "drive", isSidecar: { $ne: true }, ...newer,
    }, { session, projection: Object.fromEntries([...FIELDS, "deletedAt", "purgeState"].map((field) => [field, 1])) })
      .sort({ syncVersion: 1, _id: 1 }).limit(limit + 1).toArray();
    const removed = await DriveSyncTombstone.find({ spaceId: input.spaceId, ...newer })
      .session(session).sort({ syncVersion: 1, _id: 1 }).limit(limit + 1).lean();
    const changes: DriveSyncChange[] = [
      ...objects.map((object) => ({ objectId: String(object._id), syncVersion: object.syncVersion as number,
        type: object.deletedAt || object.purgeState ? "remove" as const : "upsert" as const,
        ...(!object.deletedAt && !object.purgeState ? { object: Object.fromEntries(FIELDS.filter((field) => object[field] !== undefined)
          .map((field) => [field, object[field]])) } : {}),
      })),
      ...removed.map((item) => ({ objectId: String(item._id), syncVersion: item.syncVersion, type: "remove" as const })),
    ].sort((a, b) => a.syncVersion - b.syncVersion || a.objectId.localeCompare(b.objectId));
    if (changes.some((item) => !Number.isSafeInteger(item.syncVersion) || item.syncVersion < 0)) {
      throw new DriveSyncError(409, "sync_reset_required", "Development sync records are invalid");
    }
    const page = changes.slice(0, limit);
    const hasMore = changes.length > limit;
    cursor.after = hasMore ? [page.at(-1)!.syncVersion, page.at(-1)!.objectId] : [bound, ""];
    if (!hasMore) cursor.mode = "delta";
    return { accountId: input.accountId, spaceId: input.spaceId, reset: previous === null,
      changes: page, cursor: encodeDriveSyncCursor(cursor), hasMore };
  });
}

import { type ClientSession, Types } from "mongoose";
import { connectDatabase, getDatabase, withTransaction } from "../connection";
import { DriveUploadCommitError, loadSpaceUsage } from "./drive-uploads";

/**
 * Drive's folder tree is metadata: `folderId` (parent, null at the Space root)
 * and `ancestorIds` (root-to-parent chain). Physical object keys never encode
 * a location, so no structural operation touches a blob.
 */
export const DRIVE_FOLDER_CONTENT_TYPE = "application/x-directory";
export const DRIVE_FOLDER_MAX_DEPTH = 32;
export const DRIVE_FOLDER_SELECTION_LIMIT = 100;
/** Binning is a cheap soft delete; large "select all" batches are allowed. */
export const DRIVE_BIN_SELECTION_LIMIT = 10_000;

export interface DriveFolderPlacement {
  folderId: Types.ObjectId | null;
  ancestorIds: Types.ObjectId[];
}

interface StoredDriveObject {
  _id: Types.ObjectId;
  contentType?: string;
  folderId?: Types.ObjectId | null;
  ancestorIds?: Types.ObjectId[];
  deletedAt?: Date | null;
  isSidecar?: boolean;
  key?: string;
}

const LIVE = { deletedAt: null, purgeState: { $exists: false } } as const;

function objects() {
  return getDatabase().collection<StoredDriveObject>("storageobjects");
}

function isFolder(object: Pick<StoredDriveObject, "contentType">) {
  return object.contentType === DRIVE_FOLDER_CONTENT_TYPE;
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== "string" || !/^[a-f0-9]{24}$/iu.test(value)) {
    throw new DriveUploadCommitError(400, code, "Invalid identifier");
  }
  return new Types.ObjectId(value);
}

export function parseDriveObjectIds(
  value: unknown,
  limit = DRIVE_FOLDER_SELECTION_LIMIT,
): Types.ObjectId[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DriveUploadCommitError(400, "invalid_selection", "Select at least one item");
  }
  const ids = [...new Set(value)].map((id) => objectId(id, "invalid_selection"));
  if (ids.length > limit) {
    throw new DriveUploadCommitError(400, "selection_too_large", `Select at most ${limit} items`);
  }
  return ids;
}

/** Resolve a live destination folder in the Space; null means the Space root. */
export async function resolveDriveFolderPlacement(
  spaceId: string,
  folderId: unknown,
  session?: ClientSession,
): Promise<DriveFolderPlacement> {
  if (folderId === null || folderId === undefined) {
    return { folderId: null, ancestorIds: [] };
  }
  const id = objectId(folderId, "invalid_folder");
  const folder = await objects().findOne(
    { _id: id, spaceId, productId: "drive", contentType: DRIVE_FOLDER_CONTENT_TYPE, ...LIVE },
    { session, projection: { ancestorIds: 1 } },
  );
  if (!folder) {
    throw new DriveUploadCommitError(404, "folder_not_found", "Folder not found");
  }
  const ancestorIds = [...(folder.ancestorIds ?? []), folder._id];
  if (ancestorIds.length > DRIVE_FOLDER_MAX_DEPTH) {
    throw new DriveUploadCommitError(400, "folder_depth_exceeded", "Folders can be nested at most 32 levels deep");
  }
  return { folderId: folder._id, ancestorIds };
}

/**
 * Placement for a newly committed object: a sidecar inherits its live parent
 * file's placement (and must have one in the same Space); anything else goes
 * to the requested live folder or the Space root.
 */
export async function resolveNewDriveObjectPlacement(
  spaceId: string,
  storageObject: { isSidecar?: unknown; parentObjectId?: unknown },
  folderId: unknown,
  session: ClientSession,
): Promise<DriveFolderPlacement> {
  if (storageObject.parentObjectId !== undefined && storageObject.parentObjectId !== null) {
    const parentId = storageObject.parentObjectId instanceof Types.ObjectId
      ? storageObject.parentObjectId
      : objectId(String(storageObject.parentObjectId), "invalid_parent_object");
    const parent = await objects().findOne(
      {
        _id: parentId,
        spaceId,
        productId: "drive",
        isSidecar: { $ne: true },
        contentType: { $ne: DRIVE_FOLDER_CONTENT_TYPE },
        ...LIVE,
      },
      { session, projection: { folderId: 1, ancestorIds: 1 } },
    );
    if (!parent) {
      throw new DriveUploadCommitError(404, "parent_object_not_found", "Sidecar parent not found");
    }
    return { folderId: parent.folderId ?? null, ancestorIds: parent.ancestorIds ?? [] };
  }
  if (storageObject.isSidecar === true) {
    throw new DriveUploadCommitError(400, "parent_object_required", "Sidecars require a parent object");
  }
  return resolveDriveFolderPlacement(spaceId, folderId, session);
}

export async function createDriveFolder(input: {
  spaceId: string;
  bucketId: Types.ObjectId;
  accountId: string;
  storageRoot: string;
  parentFolderId: unknown;
  encryptedDisplayName: unknown;
}) {
  if (
    typeof input.encryptedDisplayName !== "string" ||
    input.encryptedDisplayName.length < 16 ||
    input.encryptedDisplayName.length > 4096
  ) {
    throw new DriveUploadCommitError(400, "encrypted_name_required", "An encrypted folder name is required");
  }
  if (!input.storageRoot.endsWith("/")) throw new Error("Invalid storage root");
  await connectDatabase();
  return withTransaction(async (session) => {
    // Fences the active Space against retirement, like an upload commit.
    const { usages, ownerFilter } = await loadSpaceUsage(input.spaceId, undefined, session);
    const placement = await resolveDriveFolderPlacement(input.spaceId, input.parentFolderId, session);
    const _id = new Types.ObjectId();
    const now = new Date();
    const folder = {
      _id,
      productId: "drive",
      spaceId: input.spaceId,
      createdByAccountId: input.accountId,
      bucketId: input.bucketId,
      // Opaque identity only: never a physical object, never a name.
      key: `${input.storageRoot}${_id.toHexString()}/`,
      size: 0,
      contentType: DRIVE_FOLDER_CONTENT_TYPE,
      mediaCategory: "other",
      b2FileId: "",
      tags: [],
      position: 0,
      isEncrypted: true,
      encryptedDisplayName: input.encryptedDisplayName,
      isSidecar: false,
      revision: 0,
      folderId: placement.folderId,
      ancestorIds: placement.ancestorIds,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    };
    await getDatabase().collection("storageobjects").insertOne(folder, { session });
    // A folder is a zero-byte record; purge retires it like any other object.
    await usages.updateOne(ownerFilter, { $inc: { totalObjects: 1 }, $set: { updatedAt: now } }, { session });
    const bucket = await getDatabase().collection("buckets").updateOne(
      { _id: input.bucketId }, { $inc: { objectCount: 1 }, $set: { updatedAt: now } }, { session },
    );
    if (bucket.matchedCount !== 1) {
      throw new DriveUploadCommitError(409, "bucket_missing", "Regional bucket metadata is missing");
    }
    return folder;
  });
}

/** Ancestor chain rewrite: `[...prefix, rootId, ...chain below rootId]`. */
function rewriteAncestors(rootId: Types.ObjectId, prefix: Types.ObjectId[], now: Date) {
  return [
    {
      $set: {
        ancestorIds: {
          $concatArrays: [
            prefix,
            [rootId],
            {
              $slice: [
                "$ancestorIds",
                { $add: [{ $indexOfArray: ["$ancestorIds", rootId] }, 1] },
                DRIVE_FOLDER_MAX_DEPTH + 1,
              ],
            },
          ],
        },
        updatedAt: now,
        __v: { $add: [{ $ifNull: ["$__v", 0] }, 1] },
      },
    },
  ];
}

async function deepestRelativeDepth(spaceId: string, folder: StoredDriveObject, session: ClientSession) {
  const [deepest] = await objects().aggregate<{ depth: number }>([
    { $match: { spaceId, productId: "drive", ancestorIds: folder._id } },
    { $project: { depth: { $size: "$ancestorIds" } } },
    { $sort: { depth: -1 } },
    { $limit: 1 },
  ], { session }).toArray();
  // Ancestors a descendant keeps below the moved folder (including it).
  return deepest ? deepest.depth - (folder.ancestorIds?.length ?? 0) : 0;
}

/** Place an object (and, for a folder, its subtree) under `placement`. */
async function placeSubtree(
  spaceId: string,
  object: StoredDriveObject,
  placement: DriveFolderPlacement,
  session: ClientSession,
  now: Date,
) {
  if (isFolder(object)) {
    if (placement.ancestorIds.length + (await deepestRelativeDepth(spaceId, object, session)) > DRIVE_FOLDER_MAX_DEPTH) {
      throw new DriveUploadCommitError(400, "folder_depth_exceeded", "Folders can be nested at most 32 levels deep");
    }
    await objects().updateMany(
      { spaceId, productId: "drive", ancestorIds: object._id, purgeState: { $exists: false } },
      rewriteAncestors(object._id, placement.ancestorIds, now),
      { session },
    );
  } else {
    await objects().updateMany(
      { spaceId, productId: "drive", parentObjectId: object._id, purgeState: { $exists: false } },
      { $set: { folderId: placement.folderId, ancestorIds: placement.ancestorIds, updatedAt: now }, $inc: { __v: 1 } },
      { session },
    );
  }
  await objects().updateOne(
    { _id: object._id, spaceId, productId: "drive", purgeState: { $exists: false } },
    { $set: { folderId: placement.folderId, ancestorIds: placement.ancestorIds, updatedAt: now }, $inc: { __v: 1 } },
    { session },
  );
}

/** Keep only selections not already inside another selected folder. */
function selectionRoots(selected: StoredDriveObject[]) {
  const folderIds = new Set(selected.filter(isFolder).map((object) => String(object._id)));
  return selected.filter(
    (object) => !(object.ancestorIds ?? []).some((id) => folderIds.has(String(id))),
  );
}

/** Metadata-only move. Blobs, versions and signed URLs are never touched. */
export async function moveDriveObjects(input: {
  spaceId: string;
  objectIds: unknown;
  destinationFolderId: unknown;
}) {
  const ids = parseDriveObjectIds(input.objectIds);
  await connectDatabase();
  return withTransaction(async (session) => {
    const destination = await resolveDriveFolderPlacement(input.spaceId, input.destinationFolderId, session);
    const selected = await objects().find(
      { _id: { $in: ids }, spaceId: input.spaceId, productId: "drive", isSidecar: { $ne: true }, ...LIVE },
      { session, projection: { contentType: 1, folderId: 1, ancestorIds: 1 } },
    ).toArray();
    if (selected.length !== ids.length) {
      throw new DriveUploadCommitError(404, "object_not_found", "Some items were not found");
    }
    for (const object of selected) {
      if (
        destination.folderId?.equals(object._id) ||
        destination.ancestorIds.some((id) => id.equals(object._id))
      ) {
        throw new DriveUploadCommitError(400, "folder_cycle", "A folder cannot be moved into itself");
      }
    }
    const now = new Date();
    const roots = selectionRoots(selected);
    for (const object of roots) {
      await placeSubtree(input.spaceId, object, destination, session, now);
    }
    return { movedIds: roots.map((object) => object._id), destination };
  });
}

/**
 * Move a selection to the Bin. Folders take every live descendant with them,
 * files take their sidecars, and the whole batch shares one `deletedAt` so a
 * restore or purge of the folder acts on exactly what was binned with it.
 */
export async function binDriveObjects(input: { spaceId: string; objectIds: unknown }) {
  const ids = parseDriveObjectIds(input.objectIds, DRIVE_BIN_SELECTION_LIMIT);
  await connectDatabase();
  return withTransaction(async (session) => {
    const primaries = await objects().find(
      { _id: { $in: ids }, spaceId: input.spaceId, productId: "drive", ...LIVE },
      { session, projection: { contentType: 1, key: 1, folderId: 1 } },
    ).toArray();
    if (!primaries.length) return { binnedIds: [] as Types.ObjectId[], primaries };
    const folderIds = primaries.filter(isFolder).map((object) => object._id);
    const descendants = folderIds.length
      ? await objects().find(
          { spaceId: input.spaceId, productId: "drive", ancestorIds: { $in: folderIds }, ...LIVE },
          { session, projection: { _id: 1 } },
        ).toArray()
      : [];
    const withDescendants = [...primaries, ...descendants].map((object) => object._id);
    const sidecars = await objects().find(
      { spaceId: input.spaceId, productId: "drive", parentObjectId: { $in: withDescendants }, ...LIVE },
      { session, projection: { _id: 1 } },
    ).toArray();
    const binnedIds = [
      ...new Map(
        [...withDescendants, ...sidecars.map((object) => object._id)].map((id) => [String(id), id]),
      ).values(),
    ];
    const now = new Date();
    await objects().updateMany(
      { _id: { $in: binnedIds }, spaceId: input.spaceId, productId: "drive", ...LIVE },
      { $set: { deletedAt: now, updatedAt: now }, $inc: { __v: 1 } },
      { session },
    );
    return { binnedIds, primaries };
  });
}

/**
 * After a restore, move every restored item whose parent is not live under
 * its deepest live ancestor (or the root). Live folders always have live
 * ancestors, so the chosen ancestor's own chain is valid.
 */
export async function rehomeRestoredDriveObjects(
  spaceId: string,
  restoredIds: Types.ObjectId[],
  session: ClientSession,
) {
  if (!restoredIds.length) return;
  const restored = await objects().find(
    { _id: { $in: restoredIds }, spaceId, productId: "drive" },
    { session, projection: { contentType: 1, folderId: 1, ancestorIds: 1, isSidecar: 1 } },
  ).toArray();
  const restoredSet = new Set(restored.map((object) => String(object._id)));
  const now = new Date();
  for (const object of restored) {
    if (object.isSidecar || !object.folderId || restoredSet.has(String(object.folderId))) continue;
    const parentLive = await objects().countDocuments(
      { _id: object.folderId, spaceId, productId: "drive", contentType: DRIVE_FOLDER_CONTENT_TYPE, ...LIVE },
      { session },
    );
    if (parentLive) continue;
    const liveAncestors = await objects().find(
      { _id: { $in: object.ancestorIds ?? [] }, spaceId, productId: "drive", contentType: DRIVE_FOLDER_CONTENT_TYPE, ...LIVE },
      { session, projection: { ancestorIds: 1 } },
    ).toArray();
    const deepest = liveAncestors.sort(
      (left, right) => (right.ancestorIds?.length ?? 0) - (left.ancestorIds?.length ?? 0),
    )[0];
    const placement: DriveFolderPlacement = deepest
      ? { folderId: deepest._id, ancestorIds: [...(deepest.ancestorIds ?? []), deepest._id] }
      : { folderId: null, ancestorIds: [] };
    await placeSubtree(spaceId, object, placement, session, now);
  }
}

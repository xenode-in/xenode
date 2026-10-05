import { stampDriveSyncObjects } from "./drive-sync";
import { withTransaction, getDatabase, connectDatabase } from "../connection";
import { SpaceProductKey } from "../models";
import { queueDriveBinPurge, cleanupDriveBinObject } from "./drive-bin";
import { DriveUploadCommitError } from "./drive-uploads";

interface RetiringSpace { _id: string; type: string; organizationId: string; teamId?: string; ownerAccountId?: string; status: string }
const spacesCollection = () => getDatabase().collection<RetiringSpace>("spaces");

/** Stop all Space access and share-file access before retiring child ciphertext. */
export async function beginTeamRetirement(input: { orgId: string; teamId: string; spaceId: string }) {
  return withTransaction(async (session) => {
    const db = getDatabase();
    const team = await db.collection("team").findOne({ id: input.teamId, organizationId: input.orgId }, { session });
    if (!team) throw new DriveUploadCommitError(404, "team_missing", "Team is unavailable");
    if (team.purgeState === "pending") return;
    if (team.purgeState) throw new DriveUploadCommitError(409, "team_cleanup_blocked", "Team cleanup requires review");
    const space = await spacesCollection().findOne({ _id: input.spaceId, type: "team", organizationId: input.orgId, teamId: input.teamId, status: "active" }, { session });
    if (!space) throw new DriveUploadCommitError(409, "space_unavailable", "Team Space is unavailable");
    if (await db.collection("storageobjects").countDocuments({ spaceId: input.spaceId, productId: { $ne: "drive" } }, { session })) {
      throw new DriveUploadCommitError(409, "foreign_product_storage", "Another product still owns Team storage");
    }
    const now = new Date();
    await spacesCollection().updateOne({ _id: input.spaceId, status: "active" }, { $set: { status: "deleted", updatedAt: now } }, { session });
    await db.collection("storageobjects").updateMany({ spaceId: input.spaceId, productId: "drive", deletedAt: null, purgeState: { $exists: false } }, { $set: { deletedAt: now, updatedAt: now }, $inc: { __v: 1 } }, { session });
    await db.collection("team").updateOne({ _id: team._id, purgeState: { $exists: false } }, { $set: { purgeState: "pending", updatedAt: now } }, { session });
    await stampDriveSyncObjects(input.spaceId, { deletedAt: now }, session, true);
  });
}

/**
 * Account deletion: close the personal Space and bin its Drive files so the
 * purge pipeline deletes their ciphertext and releases their bytes; the quota
 * record and Space go once storage is empty (`finishPersonalRetirement`).
 * Refused while the account belongs to an organization or another product
 * still stores data in the Space. Returns the Space id, or null if none.
 */
export async function beginPersonalRetirement(input: { accountId: string }) {
  return withTransaction(async (session) => {
    const db = getDatabase();
    const space = await spacesCollection().findOne(
      { type: "personal", ownerAccountId: input.accountId },
      { session },
    );
    if (!space) return null;
    if (space.status === "deleted") return space._id;
    if (await db.collection("member").countDocuments({ userId: input.accountId }, { session })) {
      throw new DriveUploadCommitError(409, "organization_membership", "Remove the account from its organizations first");
    }
    if (await db.collection("storageobjects").countDocuments({ spaceId: space._id, productId: { $ne: "drive" } }, { session })) {
      throw new DriveUploadCommitError(409, "foreign_product_storage", "Another product still stores this account's data");
    }
    const now = new Date();
    await spacesCollection().updateOne({ _id: space._id, status: space.status }, { $set: { status: "deleted", updatedAt: now } }, { session });
    await db.collection("storageobjects").updateMany(
      { spaceId: space._id, productId: "drive", deletedAt: null, purgeState: { $exists: false } },
      { $set: { deletedAt: now, updatedAt: now }, $inc: { __v: 1 } },
      { session },
    );
    await stampDriveSyncObjects(space._id, { deletedAt: now }, session, true);
    return space._id;
  });
}

/** Org recovery stays possible until this single durable transition begins. */
export async function beginOrganizationRetirement(input: { orgId: string; now?: Date }) {
  const now = input.now ?? new Date();
  return withTransaction(async (session) => {
    const db = getDatabase();
    const org = await db.collection("organization").findOne({
      id: input.orgId, deletedAt: { $type: "date" }, scheduledPurgeAt: { $lte: now },
    }, { session });
    if (!org) return false;
    if (org.purgeState === "pending") return true;
    if (org.purgeState) return false;
    const spaces = await spacesCollection().find({ organizationId: input.orgId }, { session }).toArray();
    if (await db.collection("storageobjects").countDocuments({ spaceId: { $in: spaces.map((space) => space._id) }, productId: { $ne: "drive" } }, { session })) {
      throw new DriveUploadCommitError(409, "foreign_product_storage", "Another product still owns Organization storage");
    }
    await db.collection("organization").updateOne({ _id: org._id, purgeState: { $exists: false } }, { $set: { purgeState: "pending", updatedAt: now } }, { session });
    await db.collection("team").updateMany({ organizationId: input.orgId, purgeState: { $exists: false } }, { $set: { purgeState: "pending", updatedAt: now } }, { session });
    await spacesCollection().updateMany({ organizationId: input.orgId }, { $set: { status: "deleted", updatedAt: now } }, { session });
    await db.collection("storageobjects").updateMany({
      spaceId: { $in: spaces.map((space) => space._id) }, productId: "drive", deletedAt: null, purgeState: { $exists: false },
    }, { $set: { deletedAt: now, updatedAt: now }, $inc: { __v: 1 } }, { session });
    for (const space of spaces) await stampDriveSyncObjects(space._id, { deletedAt: now }, session, true);
    return true;
  });
}

export async function setOrganizationSoftDeleted(input: { orgId: string; deletedAt: Date; scheduledPurgeAt: Date }) {
  return withTransaction(async (session) => {
    const db = getDatabase();
    const updated = await db.collection("organization").updateOne({ id: input.orgId, deletedAt: null, purgeState: { $exists: false } }, {
      $set: { deletedAt: input.deletedAt, scheduledPurgeAt: input.scheduledPurgeAt, updatedAt: input.deletedAt },
    }, { session });
    if (updated.matchedCount !== 1) throw new DriveUploadCommitError(409, "organization_unavailable", "Organization cannot be deleted");
    await spacesCollection().updateMany({ organizationId: input.orgId, status: "active" }, { $set: { status: "suspended", updatedAt: input.deletedAt } }, { session });
  });
}

export async function restoreSoftDeletedOrganization(input: { orgId: string; now?: Date }) {
  const now = input.now ?? new Date();
  return withTransaction(async (session) => {
    const db = getDatabase();
    const restored = await db.collection("organization").updateOne({
      id: input.orgId, deletedAt: { $type: "date" }, scheduledPurgeAt: { $gt: now }, purgeState: { $exists: false },
    }, { $unset: { deletedAt: "", scheduledPurgeAt: "" }, $set: { updatedAt: now } }, { session });
    if (restored.matchedCount !== 1) throw new DriveUploadCommitError(409, "organization_recovery_closed", "Organization recovery is no longer available");
    await spacesCollection().updateMany({ organizationId: input.orgId, status: "suspended" }, { $set: { status: "active", updatedAt: now } }, { session });
  });
}

async function uploadsRemain(spaceId: string) {
  return getDatabase().collection("uploadsessions").countDocuments({ spaceId, $or: [
    { status: { $in: ["pending", "completing", "cleaning", "blocked"] } },
    { status: "completed", cleanupState: { $ne: "done" } },
  ] });
}

/** One bounded HTTP-cron step; parent records are retired only after child cleanup. */
export async function processRetiringSpace(input: {
  spaceId: string; batchSize?: number; now?: Date;
  deleteBlobs: (bucketName: string, keys: string[]) => Promise<void>;
}) {
  await connectDatabase();
  const db = getDatabase(), now = input.now ?? new Date(), batchSize = Math.min(100, Math.max(1, input.batchSize ?? 20));
  const space = await spacesCollection().findOne({ _id: input.spaceId, status: "deleted" });
  if (!space) return { scanned: 0, deleted: 0, waiting: 0, failed: 0, complete: false };
  const objects = db.collection("storageobjects");
  const unqueued = await objects.find({ spaceId: input.spaceId, productId: "drive", purgeState: { $exists: false }, "versions.pendingDeletion": { $ne: true } })
    .sort({ _id: 1 }).limit(batchSize).project({ _id: 1, bucketId: 1, purgeState: 1 }).toArray();
  const queued = unqueued.length < batchSize ? await objects.find({
    spaceId: input.spaceId, productId: "drive", purgeState: "pending", purgeAfter: { $lte: now },
    $and: [
      { $or: [{ purgeNextAttemptAt: { $exists: false } }, { purgeNextAttemptAt: { $lte: now } }] },
      { $or: [{ purgeLeaseExpiresAt: { $exists: false } }, { purgeLeaseExpiresAt: { $lte: now } }] },
    ],
  }).sort({ _id: 1 }).limit(batchSize - unqueued.length).project({ _id: 1, bucketId: 1, purgeState: 1 }).toArray() : [];
  const candidates = [...unqueued, ...queued];
  let deleted = 0, waiting = 0, failed = 0;
  for (const object of candidates) {
    try {
      if (!object.purgeState) await queueDriveBinPurge({ spaceId: input.spaceId, bucketId: object.bucketId, ids: [object._id], includeRelated: false });
      const result = await cleanupDriveBinObject({ objectId: object._id, now, deleteBlobs: input.deleteBlobs });
      if (result === "deleted") deleted++;
      else if (result === "retry") failed++;
      else waiting++;
    } catch { failed++; }
  }
  const complete = await db.collection("storageobjects").countDocuments({ spaceId: input.spaceId }) === 0 &&
    await uploadsRemain(input.spaceId) === 0;
  return { scanned: candidates.length, deleted, waiting, failed, complete };
}

/** Remove a retired personal Space and its quota record once storage is empty. */
export async function finishPersonalRetirement(input: { spaceId: string }) {
  return withTransaction(async (session) => {
    const db = getDatabase();
    const space = await spacesCollection().findOne({ _id: input.spaceId, type: "personal", status: "deleted" }, { session });
    if (!space?.ownerAccountId) return false;
    if (await db.collection("storageobjects").countDocuments({ spaceId: input.spaceId }, { session }) ||
      await db.collection("uploadsessions").countDocuments({ spaceId: input.spaceId, $or: [
        { status: { $in: ["pending", "completing", "cleaning", "blocked"] } }, { status: "completed", cleanupState: { $ne: "done" } },
      ] }, { session })) return false;
    const albums = await db.collection("photoalbums").find({ spaceId: input.spaceId }, { session }).project({ _id: 1 }).toArray();
    await db.collection("albumsharelinks").deleteMany({ albumId: { $in: albums.map((album) => album._id) } }, { session });
    await db.collection("photoalbums").deleteMany({ spaceId: input.spaceId }, { session });
    await db.collection("uploadsessions").deleteMany({ spaceId: input.spaceId, status: "completed", cleanupState: "done" }, { session });
    await SpaceProductKey.deleteMany({ spaceId: input.spaceId }, { session });
    await db.collection("usages").deleteOne({ userId: space.ownerAccountId }, { session });
    await spacesCollection().deleteOne({ _id: input.spaceId, status: "deleted" }, { session });
    return true;
  });
}

export async function finishTeamRetirement(input: { orgId: string; teamId: string; spaceId: string }) {
  return withTransaction(async (session) => {
    const db = getDatabase();
    const team = await db.collection("team").findOne({ id: input.teamId, organizationId: input.orgId, purgeState: "pending" }, { session });
    if (!team) return false;
    if (await db.collection("storageobjects").countDocuments({ spaceId: input.spaceId }, { session }) ||
      await db.collection("uploadsessions").countDocuments({ spaceId: input.spaceId, $or: [
        { status: { $in: ["pending", "completing", "cleaning", "blocked"] } }, { status: "completed", cleanupState: { $ne: "done" } },
      ] }, { session })) return false;
    const albums = await db.collection("photoalbums").find({ spaceId: input.spaceId }, { session }).project({ _id: 1 }).toArray();
    await db.collection("albumsharelinks").deleteMany({ albumId: { $in: albums.map((album) => album._id) } }, { session });
    await db.collection("photoalbums").deleteMany({ spaceId: input.spaceId }, { session });
    await db.collection("uploadsessions").deleteMany({ spaceId: input.spaceId, status: "completed", cleanupState: "done" }, { session });
    await SpaceProductKey.deleteMany({ spaceId: input.spaceId }, { session });
    await db.collection("teamMember").deleteMany({ teamId: input.teamId }, { session });
    await db.collection("team").deleteOne({ _id: team._id, purgeState: "pending" }, { session });
    await spacesCollection().deleteOne({ _id: input.spaceId, status: "deleted" }, { session });
    return true;
  });
}

export async function finishOrganizationRetirement(input: { orgId: string }) {
  return withTransaction(async (session) => {
    const db = getDatabase();
    const org = await db.collection("organization").findOne({ id: input.orgId, purgeState: "pending" }, { session });
    if (!org) return false;
    const spaces = await spacesCollection().find({ organizationId: input.orgId }, { session }).toArray();
    if (spaces.some((space) => space.type === "team") ||
      await db.collection("team").countDocuments({ organizationId: input.orgId }, { session }) ||
      await db.collection("storageobjects").countDocuments({ spaceId: { $in: spaces.map((space) => space._id) } }, { session }) ||
      await db.collection("uploadsessions").countDocuments({ spaceId: { $in: spaces.map((space) => space._id) }, $or: [
        { status: { $in: ["pending", "completing", "cleaning", "blocked"] } }, { status: "completed", cleanupState: { $ne: "done" } },
      ] }, { session })) return false;
    const spaceIds = spaces.map((space) => space._id);
    const albums = await db.collection("photoalbums").find({ spaceId: { $in: spaceIds } }, { session }).project({ _id: 1 }).toArray();
    await db.collection("albumsharelinks").deleteMany({ albumId: { $in: albums.map((album) => album._id) } }, { session });
    await db.collection("photoalbums").deleteMany({ spaceId: { $in: spaceIds } }, { session });
    await db.collection("uploadsessions").deleteMany({ spaceId: { $in: spaceIds }, status: "completed", cleanupState: "done" }, { session });
    await SpaceProductKey.deleteMany({ spaceId: { $in: spaces.map((space) => space._id) } }, { session });
    await spacesCollection().deleteMany({ organizationId: input.orgId }, { session });
    await db.collection("orgusages").deleteMany({ orgId: input.orgId }, { session });
    await db.collection("organizationpolicies").deleteMany({ orgId: input.orgId }, { session });
    await db.collection("orgdomains").deleteMany({ orgId: input.orgId }, { session });
    await db.collection("member").deleteMany({ organizationId: input.orgId }, { session });
    await db.collection("invitation").deleteMany({ organizationId: input.orgId }, { session });
    await db.collection("organization").deleteOne({ _id: org._id, purgeState: "pending" }, { session });
    return true;
  });
}

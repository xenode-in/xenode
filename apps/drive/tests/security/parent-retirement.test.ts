import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { Space } from "@xenode/database/models";
import { beginOrganizationRetirement, beginTeamRetirement, finishTeamRetirement, processRetiringSpace, restoreSoftDeletedOrganization, setOrganizationSoftDeleted } from "@xenode/database/repositories";
import { organizationSpaceId, teamSpaceId } from "@xenode/spaces/ids";
import { hasActiveSharedObject } from "@/lib/orgs/activeSharedObject";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import OrgUsage from "@/models/OrgUsage";
import { GET as purgeOrgs } from "@/app/api/cron/purge-orgs/route";
import { DELETE as deleteTeam } from "@/app/api/orgs/[orgId]/teams/[teamId]/route";
import { POST as createTeam } from "@/app/api/orgs/[orgId]/teams/route";
import { GET as publicShare } from "@/app/api/share/[token]/route";
import { POST as publicStream } from "@/app/api/share/[token]/stream/route";
import { POST as directStream } from "@/app/api/direct-shares/[id]/stream/route";
import { GET as albumShare } from "@/app/api/album-share/[token]/route";
import { POST as albumStream } from "@/app/api/album-share/[token]/objects/[objectId]/stream/route";
import ShareLink from "@/models/ShareLink";
import DirectShare from "@/models/DirectShare";
import PhotoAlbum from "@/models/PhotoAlbum";
import AlbumShareLink from "@/models/AlbumShareLink";
import { reserveUploadSession, attachToUploadSession } from "@/lib/uploads/session";

const { deleted, context } = vi.hoisted(() => ({ deleted: vi.fn(), context: vi.fn() }));
vi.mock("@/lib/b2/objects", () => ({ deleteObjects: deleted }));
vi.mock("@/lib/authz", async (original) => ({ ...await original<typeof import("@/lib/authz")>(), requireAccessContext: context }));

const orgId = "retirement-org", teamId = "retirement-team", owner = "retirement-owner";
const orgSpaceId = organizationSpaceId(orgId), tSpaceId = teamSpaceId(orgId, teamId);
const cronRequest = () => new NextRequest("http://localhost/api/cron/purge-orgs", { headers: { authorization: "Bearer retirement-secret" } });

async function fixture(input: { orgObject?: boolean; teamObject?: boolean; expired?: boolean; team?: boolean } = {}) {
  const past = new Date(Date.now() - 1000);
  await mongoose.connection.collection("organization").insertOne({
    id: orgId, name: "Retirement", slug: orgId,
    ...(input.expired ? { deletedAt: past, scheduledPurgeAt: past } : {}),
  });
  await mongoose.connection.collection("member").insertOne({ organizationId: orgId, userId: owner, role: "owner" });
  await Space.create({ _id: orgSpaceId, type: "organization", organizationId: orgId, createdByAccountId: owner });
  if (input.team) {
    await mongoose.connection.collection("team").insertOne({ id: teamId, organizationId: orgId, name: "Team" });
    await Space.create({ _id: tSpaceId, type: "team", organizationId: orgId, teamId, createdByAccountId: owner });
  }
  const count = Number(!!input.orgObject) + Number(!!input.teamObject);
  await OrgUsage.create({ orgId, accountId: `org:${orgId}`, totalStorageBytes: count * 100, totalObjects: count });
  const bucket = await Bucket.create({ name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage", storageRegion: "asia", objectCount: count, totalSizeBytes: count * 100 });
  const makeObject = async (spaceId: string, suffix: string) => StorageObject.create({
    productId: "drive", spaceId, createdByAccountId: owner, bucketId: bucket._id,
    key: `users/${owner}/${suffix}`, size: 100, b2FileId: suffix,
  });
  const orgObject = input.orgObject ? await makeObject(orgSpaceId, "org") : null;
  const teamObject = input.teamObject ? await makeObject(tSpaceId, "team") : null;
  return { bucket, orgObject, teamObject };
}

describe("Space parent retirement", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "retirement-secret";
    process.env.ORGS_ENABLED = "true";
    deleted.mockReset();
    context.mockReset();
    context.mockResolvedValue({ accountId: owner, userId: owner, productId: "drive" });
  });

  it("keeps a failed team deletion charged and retries it through the cron", async () => {
    const { teamObject } = await fixture({ team: true, teamObject: true });
    const albumId = new mongoose.Types.ObjectId();
    await mongoose.connection.collection("photoalbums").insertOne({ _id: albumId, spaceId: tSpaceId, objectIds: [teamObject!._id] });
    await mongoose.connection.collection("albumsharelinks").insertOne({ albumId, token: "team-album-link" });
    await mongoose.connection.collection("filecomments").insertOne({ objectId: teamObject!._id, ciphertext: "encrypted" });
    deleted.mockRejectedValueOnce(new Error("B2 refused deletion"));
    const response = await deleteTeam(new NextRequest("http://localhost/team", { method: "DELETE" }), { params: Promise.resolve({ orgId, teamId }) });
    expect(response.status).toBe(202);
    expect((await Space.findById(tSpaceId))?.status).toBe("deleted");
    expect((await StorageObject.findById(teamObject!._id))?.purgeState).toBe("pending");
    expect((await OrgUsage.findOne({ orgId }))?.totalStorageBytes).toBe(100);
    expect(await mongoose.connection.collection("team").countDocuments({ id: teamId })).toBe(1);
    await mongoose.connection.collection("storageobjects").updateOne({ _id: teamObject!._id }, { $set: { purgeNextAttemptAt: new Date(0) } });
    deleted.mockResolvedValue(undefined);
    const retry = await purgeOrgs(cronRequest());
    expect(retry.status).toBe(200);
    expect(await mongoose.connection.collection("team").countDocuments({ id: teamId })).toBe(0);
    expect(await StorageObject.countDocuments({ spaceId: tSpaceId })).toBe(0);
    expect((await OrgUsage.findOne({ orgId }))?.totalStorageBytes).toBe(0);
    expect(await mongoose.connection.collection("photoalbums").countDocuments({ spaceId: tSpaceId })).toBe(0);
    expect(await mongoose.connection.collection("albumsharelinks").countDocuments({ albumId })).toBe(0);
    expect(await mongoose.connection.collection("filecomments").countDocuments({ objectId: teamObject!._id })).toBe(0);
  });

  it("suspends shared objects during org recovery and reactivates them on restore", async () => {
    const { orgObject } = await fixture({ orgObject: true });
    expect(await hasActiveSharedObject(orgObject!._id)).toBe(true);
    const now = new Date();
    await setOrganizationSoftDeleted({ orgId, deletedAt: now, scheduledPurgeAt: new Date(now.getTime() + 86_400_000) });
    expect(await hasActiveSharedObject(orgObject!._id)).toBe(false);
    expect((await Space.findById(orgSpaceId))?.status).toBe("suspended");
    await restoreSoftDeletedOrganization({ orgId });
    expect(await hasActiveSharedObject(orgObject!._id)).toBe(true);
    expect((await Space.findById(orgSpaceId))?.status).toBe("active");
  });

  it("closes recovery when durable organization retirement begins", async () => {
    await fixture({ expired: true });
    expect(await beginOrganizationRetirement({ orgId })).toBe(true);
    await expect(restoreSoftDeletedOrganization({ orgId })).rejects.toMatchObject({ code: "organization_recovery_closed" });
    expect((await Space.findById(orgSpaceId))?.status).toBe("deleted");
  });

  it("stops public and direct share disclosure while the organization is suspended", async () => {
    const { orgObject, bucket } = await fixture({ orgObject: true });
    await ShareLink.create({ token: "retirement-token", objectId: orgObject!._id, bucketId: bucket._id, createdBy: owner, accessType: "download" });
    const direct = await DirectShare.create({
      objectId: orgObject!._id, bucketId: bucket._id, createdBy: owner,
      recipients: [{ recipientUserId: owner, recipientEmail: "owner@example.test", wrappedShareKey: "ciphertext", accessType: "viewer" }],
    });
    const now = new Date();
    await setOrganizationSoftDeleted({ orgId, deletedAt: now, scheduledPurgeAt: new Date(now.getTime() + 86_400_000) });
    expect((await publicShare(new NextRequest("http://localhost/share"), { params: Promise.resolve({ token: "retirement-token" }) })).status).toBe(404);
    expect((await publicStream(new NextRequest("http://localhost/share/stream", { method: "POST", body: "{}" }), { params: Promise.resolve({ token: "retirement-token" }) })).status).toBe(404);
    expect((await directStream(new NextRequest("http://localhost/direct/stream", { method: "POST" }), { params: Promise.resolve({ id: String(direct._id) }) })).status).toBe(404);
  });

  it("stops album-share disclosure while its Space is suspended", async () => {
    const { orgObject } = await fixture({ orgObject: true });
    const album = await PhotoAlbum.create({ spaceId: orgSpaceId, createdByAccountId: owner, slug: "album", objectIds: [orgObject!._id] });
    await AlbumShareLink.create({
      token: "retirement-album-token", albumId: album._id, createdBy: owner,
      items: [{ objectId: orgObject!._id, shareEncryptedDEK: "ciphertext", shareKeyIv: "iv" }],
    });
    const now = new Date();
    await setOrganizationSoftDeleted({ orgId, deletedAt: now, scheduledPurgeAt: new Date(now.getTime() + 86_400_000) });
    expect((await albumShare(new NextRequest("http://localhost/album"), { params: Promise.resolve({ token: "retirement-album-token" }) })).status).toBe(404);
    expect((await albumStream(new NextRequest("http://localhost/album/stream", { method: "POST", body: "{}" }), {
      params: Promise.resolve({ token: "retirement-album-token", objectId: String(orgObject!._id) }),
    })).status).toBe(404);
  });

  it("does not remove an organization or its quota after partial B2 failure", async () => {
    const { orgObject, teamObject } = await fixture({ expired: true, team: true, orgObject: true, teamObject: true });
    deleted.mockRejectedValueOnce(new Error("B2 unavailable"));
    const first = await purgeOrgs(cronRequest());
    expect(first.status).toBe(500);
    expect((await Space.findById(orgSpaceId))?.status).toBe("deleted");
    expect(await mongoose.connection.collection("organization").countDocuments({ id: orgId })).toBe(1);
    expect(await StorageObject.countDocuments({ spaceId: { $in: [orgSpaceId, tSpaceId] } })).toBe(1);
    expect((await OrgUsage.findOne({ orgId }))?.totalStorageBytes).toBe(100);
    expect((await StorageObject.findById(teamObject!._id))?.purgeState).toBe("pending");
    expect(await StorageObject.findById(orgObject!._id)).toBeNull();
    await mongoose.connection.collection("storageobjects").updateOne({ _id: teamObject!._id }, { $set: { purgeNextAttemptAt: new Date(0) } });
    deleted.mockResolvedValue(undefined);
    const second = await purgeOrgs(cronRequest());
    expect(second.status).toBe(200);
    expect((await second.json()).purgedOrgs).toBe(1);
    expect(await mongoose.connection.collection("organization").countDocuments({ id: orgId })).toBe(0);
    expect((await Bucket.findById((await Bucket.findOne())!._id))?.totalSizeBytes).toBe(0);
  });

  it.each(["pending", "completing", "blocked"])("keeps a team while an upload manifest is %s", async (status) => {
    await fixture({ team: true });
    await beginTeamRetirement({ orgId, teamId, spaceId: tSpaceId });
    await mongoose.connection.collection("uploadsessions").insertOne({ spaceId: tSpaceId, status, expiresAt: new Date(Date.now() + 60_000) });
    expect(await finishTeamRetirement({ orgId, teamId, spaceId: tSpaceId })).toBe(false);
    expect(await mongoose.connection.collection("team").countDocuments({ id: teamId })).toBe(1);
  });

  it("retires reconciled upload ledgers with their parent Space", async () => {
    await fixture({ team: true });
    await beginTeamRetirement({ orgId, teamId, spaceId: tSpaceId });
    await mongoose.connection.collection("uploadsessions").insertOne({
      spaceId: tSpaceId, status: "completed", cleanupState: "done", expiresAt: new Date(0),
    });
    expect(await finishTeamRetirement({ orgId, teamId, spaceId: tSpaceId })).toBe(true);
    expect(await mongoose.connection.collection("uploadsessions").countDocuments({ spaceId: tSpaceId })).toBe(0);
  });

  it("cannot mint or extend signed PUT reservations after team retirement starts", async () => {
    const { bucket } = await fixture({ team: true });
    const key = `users/${owner}/before-retirement`;
    const sessionId = await reserveUploadSession({ userId: owner, spaceId: tSpaceId, bucketId: bucket._id, fileId: key, keys: [key] });
    expect(sessionId).toBeTruthy();
    await beginTeamRetirement({ orgId, teamId, spaceId: tSpaceId });
    expect(await reserveUploadSession({ userId: owner, spaceId: tSpaceId, bucketId: bucket._id, fileId: `${key}-later`, keys: [`${key}-later`] })).toBeNull();
    expect(await reserveUploadSession({ userId: owner, spaceId: tSpaceId, bucketId: bucket._id, fileId: key, keys: [key], sessionId: sessionId! })).toBeNull();
    expect(await attachToUploadSession({ userId: owner, spaceId: tSpaceId, bucketId: bucket._id, parentFileId: key, parentSessionId: sessionId!, key: `${key}-thumb` })).toBeNull();
    expect(await mongoose.connection.collection("uploadsessions").countDocuments({ spaceId: tSpaceId })).toBe(1);
  });

  it("does not create a team from an authorization read made before org suspension", async () => {
    await fixture();
    const request = new NextRequest("http://localhost/teams", { method: "POST", body: "{}" });
    vi.spyOn(request, "json").mockImplementation(async () => {
      const now = new Date();
      await setOrganizationSoftDeleted({ orgId, deletedAt: now, scheduledPurgeAt: new Date(now.getTime() + 86_400_000) });
      return { name: "Late team" };
    });
    const response = await createTeam(request, { params: Promise.resolve({ orgId }) });
    expect(response.status).toBe(410);
    expect(await mongoose.connection.collection("team").countDocuments({ organizationId: orgId })).toBe(0);
    expect(await Space.countDocuments({ organizationId: orgId, type: "team" })).toBe(0);
  });

  it("retires a folder independently of more than 100 descendants", async () => {
    const { bucket } = await fixture({ team: true });
    const folder = await StorageObject.create({
      productId: "drive", spaceId: tSpaceId, createdByAccountId: owner, bucketId: bucket._id,
      key: `users/${owner}/folder/`, size: 1, b2FileId: "folder",
    });
    const children = Array.from({ length: 101 }, (_, index) => ({
      productId: "drive", spaceId: tSpaceId, createdByAccountId: owner, bucketId: bucket._id,
      key: `users/${owner}/folder/child-${index}`, size: 1, b2FileId: `child-${index}`,
    }));
    await StorageObject.insertMany(children);
    await OrgUsage.updateOne({ orgId }, { $set: { totalStorageBytes: 102, totalObjects: 102 } });
    await Bucket.updateOne({ _id: bucket._id }, { $set: { totalSizeBytes: 102, objectCount: 102 } });
    await beginTeamRetirement({ orgId, teamId, spaceId: tSpaceId });
    deleted.mockResolvedValue(undefined);
    const step = await processRetiringSpace({ spaceId: tSpaceId, batchSize: 1, deleteBlobs: deleted });
    expect(step.deleted).toBe(1);
    expect(await StorageObject.findById(folder._id)).toBeNull();
    expect(await StorageObject.countDocuments({ spaceId: tSpaceId })).toBe(101);
    expect(await finishTeamRetirement({ orgId, teamId, spaceId: tSpaceId })).toBe(false);
  });
});

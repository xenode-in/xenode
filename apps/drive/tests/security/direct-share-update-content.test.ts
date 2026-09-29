import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Space, cleanupDriveUpload, getDatabase } from "@xenode/database";
import { REVISION_HEADER } from "@/lib/storage/revisions";
const { send, sign } = vi.hoisted(() => ({ send: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/b2/client", () => ({ getS3Client: () => ({ send }) }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: sign }));
import { POST as ownerSave } from "@/app/api/objects/[id]/update-content/route";
import { POST as shareSave } from "@/app/api/direct-shares/[id]/update-content/route";
import { POST as genericComplete } from "@/app/api/objects/complete-upload/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import UploadSession from "@/models/UploadSession";
import DirectShare from "@/models/DirectShare";
import Usage from "@/models/Usage";
import OrgUsage from "@/models/OrgUsage";

const owner = "revision-owner", editor = "revision-editor";
const iv = Buffer.alloc(12, 1).toString("base64");
function session(accountId: string) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: accountId }, session: { id: "revision-session" } } as unknown as NonNullable<Awaited<ReturnType<typeof getServerSession>>>);
}
function request(body: object, revision: string | null = "0", spaceId?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (revision !== null) headers[REVISION_HEADER] = revision;
  return new NextRequest(`http://localhost/api/save${spaceId ? `?spaceId=${spaceId}` : ""}`, { method: "POST", headers, body: JSON.stringify(body) });
}
function params(id: string) { return { params: Promise.resolve({ id }) }; }

async function fixture(organization = false) {
  const spaceId = organization ? "space_org_revision-org" : `space_personal_${owner}`;
  await Space.create({ _id: spaceId, type: organization ? "organization" : "personal", ownerAccountId: organization ? undefined : owner, organizationId: organization ? "revision-org" : undefined, createdByAccountId: owner });
  if (organization) await getDatabase().collection("member").insertOne({ userId: owner, organizationId: "revision-org", role: "owner" });
  const bucket = await Bucket.create({ systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage", objectCount: 1, totalSizeBytes: 100 });
  const object = await StorageObject.create({
    bucketId: bucket._id, spaceId, createdByAccountId: owner, key: organization ? "workspaces/revision-org/objects/old" : `users/${owner}/old`,
    isEncrypted: true, encryptedDEK: "wrapped-key", encryptedName: "encrypted-name", iv: Buffer.alloc(12, 0).toString("base64"),
    size: 100, b2FileId: "original", mediaCategory: "excel",
  });
  if (organization) await OrgUsage.create({ orgId: "revision-org", accountId: "org:revision-org", totalStorageBytes: 100, totalObjects: 1 });
  else await Usage.create({ userId: owner, totalStorageBytes: 100, totalObjects: 1 });
  const share = await DirectShare.create({
    objectId: object._id, bucketId: bucket._id, createdBy: owner,
    recipients: [{ recipientUserId: editor, recipientEmail: "editor@example.test", wrappedShareKey: "wrap", accessType: "editor" }],
  });
  return { spaceId, object, bucket, share };
}
async function reserve(input: Awaited<ReturnType<typeof fixture>>, shared = false, nonce = iv) {
  session(shared ? editor : owner);
  const handler = shared ? shareSave : ownerSave;
  const response = await handler(request({ operation: "presign", size: 80, iv: nonce }, "0", shared ? undefined : input.spaceId), params(String(shared ? input.share._id : input.object._id)));
  expect(response.status).toBe(200);
  return await response.json() as { sessionId: string; uploadUrl: string };
}
async function complete(input: Awaited<ReturnType<typeof fixture>>, sessionId: string, shared = false) {
  return (shared ? shareSave : ownerSave)(request({ operation: "complete", sessionId }, "0", shared ? undefined : input.spaceId), params(String(shared ? input.share._id : input.object._id)));
}
describe("manifest-owned direct B2 revisions", () => {
  beforeEach(() => { send.mockReset(); sign.mockReset(); sign.mockResolvedValue("https://storage.test/revision"); send.mockResolvedValue({ ContentLength: 80, VersionId: "new" }); });

  it.each(["viewer", "commenter"])("denies %s before reserving or signing", async (role) => {
    const input = await fixture();
    await DirectShare.updateOne({ _id: input.share._id }, { $set: { "recipients.0.accessType": role } });
    session(editor);
    expect((await shareSave(request({ operation: "presign", size: 80, iv }), params(String(input.share._id)))).status).toBe(403);
    expect(sign).not.toHaveBeenCalled();
    expect(await UploadSession.countDocuments({})).toBe(0);
  });
  it("denies non-recipients and missing base revisions", async () => {
    const input = await fixture(); session("outsider");
    expect((await shareSave(request({ operation: "presign", size: 80, iv }), params(String(input.share._id)))).status).toBe(403);
    session(editor);
    expect((await shareSave(request({ operation: "presign", size: 80, iv }, null), params(String(input.share._id)))).status).toBe(400);
  });
  it.each([false, true])("charges the file owner and commits exactly once (organization=%s)", async (organization) => {
    const input = await fixture(organization);
    const reserved = await reserve(input, true);
    expect(await StorageObject.findById(input.object._id).then((object) => object?.revision)).toBe(0);
    const response = await complete(input, reserved.sessionId, true);
    expect(response.status).toBe(200);
    expect((await response.json()).revision).toBe(1);
    const saved = await StorageObject.findById(input.object._id).lean();
    expect(saved?.size).toBe(80);
    expect(saved?.key).not.toBe(input.object.key);
    expect(saved?.versions).toHaveLength(1);
    expect(saved?.versions?.[0]).toMatchObject({ key: input.object.key, isOriginal: true, sharesCurrentContent: false, size: 100 });
    expect(organization ? (await OrgUsage.findOne({ orgId: "revision-org" }))?.totalStorageBytes : (await Usage.findOne({ userId: owner }))?.totalStorageBytes).toBe(180);
    expect((await Bucket.findById(input.bucket._id))?.totalSizeBytes).toBe(180);
    expect(await Usage.findOne({ userId: editor })).toBeNull();
    send.mockClear();
    expect((await complete(input, reserved.sessionId, true)).status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    expect((await Bucket.findById(input.bucket._id))?.totalSizeBytes).toBe(180);
  });
  it("rejects binary bodies rather than proxying file bytes", async () => {
    const input = await fixture(); session(owner);
    const response = await ownerSave(new NextRequest(`http://localhost/save?spaceId=${input.spaceId}`, {
      method: "POST", headers: { "content-type": "application/octet-stream", [REVISION_HEADER]: "0" }, body: new Uint8Array([1,2]).buffer,
    }), params(String(input.object._id)));
    expect(response.status).toBe(415);
    expect(send).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });
  it("rejects the old in-place JSON flow without changing metadata", async () => {
    const input = await fixture(); session(owner);
    expect((await ownerSave(request({ iv }, "0", input.spaceId), params(String(input.object._id)))).status).toBe(400);
    expect((await StorageObject.findById(input.object._id))?.iv).toBe(input.object.iv);
    expect(sign).not.toHaveBeenCalled();
  });
  it("rejects reused or malformed IVs before URL signing", async () => {
    const input = await fixture(); session(owner);
    for (const value of ["bad", input.object.iv]) expect((await ownerSave(request({ operation: "presign", size: 80, iv: value }, "0", input.spaceId), params(String(input.object._id)))).status).toBe(400);
    expect(sign).not.toHaveBeenCalled();
  });
  it("denies another actor's revision manifest and generic completion", async () => {
    const input = await fixture();
    const reserved = await reserve(input, true);
    session(owner);
    expect((await complete(input, reserved.sessionId)).status).toBe(409);
    const manifest = await UploadSession.findById(reserved.sessionId);
    const response = await genericComplete(request({ objectKey: manifest!.fileId, bucketId: String(input.bucket._id), sessionId: reserved.sessionId, size: 80, isEncrypted: true, encryptedDEK: "wrap", encryptedName: "name" }, "0", input.spaceId));
    expect(response.status).toBe(409);
    expect(send).not.toHaveBeenCalled();
  });
  it("keeps mismatched B2 lengths pending and uncharged", async () => {
    const input = await fixture();
    const reserved = await reserve(input);
    send.mockResolvedValue({ ContentLength: 79 });
    expect((await complete(input, reserved.sessionId)).status).toBe(409);
    expect((await Usage.findOne({ userId: owner }))?.totalStorageBytes).toBe(100);
    expect((await UploadSession.findById(reserved.sessionId))?.status).toBe("pending");
    expect((await StorageObject.findById(input.object._id))?.revision).toBe(0);
  });
  it("rolls all writes back when quota changes after presign", async () => {
    const input = await fixture(); const reserved = await reserve(input);
    await Usage.updateOne({ userId: owner }, { $set: { storageLimitBytes: 100 } });
    expect((await complete(input, reserved.sessionId)).status).toBe(402);
    expect((await Usage.findOne({ userId: owner }))?.totalStorageBytes).toBe(100);
    expect((await UploadSession.findById(reserved.sessionId))?.status).toBe("pending");
    expect((await StorageObject.findById(input.object._id))?.versions).toHaveLength(0);
  });
  it("commits one concurrent editor save and leaves its loser reserved for cleanup", async () => {
    const input = await fixture();
    const first = await reserve(input, true), second = await reserve(input, true, Buffer.alloc(12,2).toString("base64"));
    const results = await Promise.all([complete(input, first.sessionId, true), complete(input, second.sessionId, true)]);
    expect(results.map((result) => result.status).sort()).toEqual([200,409]);
    expect((await Usage.findOne({ userId: owner }))?.totalStorageBytes).toBe(180);
    expect((await StorageObject.findById(input.object._id))?.versions).toHaveLength(1);
    expect(await UploadSession.countDocuments({ status: "pending" })).toBe(1);
  });
  it("rechecks share revocation during completion", async () => {
    const input = await fixture(); const reserved = await reserve(input, true);
    send.mockImplementationOnce(async () => { await DirectShare.updateOne({ _id: input.share._id }, { $set: { isRevoked: true } }); return { ContentLength: 80 }; });
    expect((await complete(input, reserved.sessionId, true)).status).toBe(403);
    expect((await Usage.findOne({ userId: owner }))?.totalStorageBytes).toBe(100);
    expect((await UploadSession.findById(reserved.sessionId))?.status).toBe("pending");
  });
  it("rolls back when bucket routing disappears during HEAD", async () => {
    const input = await fixture(); const reserved = await reserve(input);
    send.mockImplementationOnce(async () => { await Bucket.deleteOne({ _id: input.bucket._id }); return { ContentLength: 80 }; });
    expect((await complete(input, reserved.sessionId)).status).toBe(409);
    expect((await StorageObject.findById(input.object._id))?.revision).toBe(0);
    expect((await Usage.findOne({ userId: owner }))?.totalStorageBytes).toBe(100);
  });
  it("does not allow an orphan cleanup claim to finalize", async () => {
    const input = await fixture(); const reserved = await reserve(input);
    const gate = new Promise<void>((resolve) => { send.mockImplementationOnce(async () => { await cleanupDriveUpload({ sessionId: reserved.sessionId, now: new Date(Date.now()+25*60*60*1000), deleteBlobs: async () => {} }); resolve(); return { ContentLength: 80 }; }); });
    expect((await complete(input, reserved.sessionId)).status).toBe(409);
    await gate;
    expect((await Usage.findOne({ userId: owner }))?.totalStorageBytes).toBe(100);
  });
  it("fences a stale hydrated document after transactional completion", async () => {
    const input = await fixture(); const stale = await StorageObject.findById(input.object._id);
    const reserved = await reserve(input);
    expect((await complete(input, reserved.sessionId)).status).toBe(200);
    stale!.position = 4;
    await expect(stale!.save()).rejects.toMatchObject({ name: "VersionError" });
  });
  it("atomically permits one pending claim per file IV", async () => {
    const input = await fixture(); session(owner);
    const response = await Promise.all([ownerSave, ownerSave].map((handler) =>
      handler(request({ operation: "presign", size: 80, iv }, "0", input.spaceId), params(String(input.object._id))),
    ));
    expect(response.map((item) => item.status).sort()).toEqual([200,409]);
    expect(await UploadSession.countDocuments({ purpose: "revision" })).toBe(1);
  });
  it("retains and charges overflow versions until confirmed cleanup", async () => {
    const input = await fixture();
    await StorageObject.updateOne({ _id: input.object._id }, { $set: { versions: [
      ...Array.from({ length: 9 }, (_, index) => ({ versionId: `v${index}`, key: `users/${owner}/v${index}`, size: 10, createdAt: new Date(), createdBy: owner })),
      { versionId: "original", isOriginal: true, key: `users/${owner}/first`, size: 10, createdAt: new Date(), createdBy: owner },
    ] } });
    await Usage.updateOne({ userId: owner }, { $set: { totalStorageBytes: 200 } });
    await Bucket.updateOne({ _id: input.bucket._id }, { $set: { totalSizeBytes: 200 } });
    const reserved = await reserve(input);
    expect((await complete(input, reserved.sessionId)).status).toBe(200);
    const saved = await StorageObject.findById(input.object._id).lean();
    expect(saved?.versions).toHaveLength(11);
    expect(saved?.versions?.filter((version) => !version.pendingDeletion)).toHaveLength(10);
    expect(saved?.versions?.find((version) => version.versionId === "v8")?.pendingDeletion).toBe(true);
    expect((await Usage.findOne({ userId: owner }))?.totalStorageBytes).toBe(280);
    expect((await Bucket.findById(input.bucket._id))?.totalSizeBytes).toBe(280);
  });
});

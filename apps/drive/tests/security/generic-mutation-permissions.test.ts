import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Space, getDatabase } from "@xenode/database";
import type { SpaceRole } from "@xenode/contracts";

const { send, sign, publish } = vi.hoisted(() => ({ send: vi.fn(), sign: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/b2/client", () => ({ getS3Client: () => ({ send }) }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: sign }));
vi.mock("@/lib/subscriptions/service", () => ({ enforceStorageAccess: vi.fn() }));
vi.mock("@/lib/logRequest", () => ({ logRequest: vi.fn() }));
vi.mock("@/lib/realtime/publish", () => ({ publishSyncEvent: publish, parentPrefixForKey: vi.fn(), toSyncObjectSnapshot: vi.fn() }));
vi.mock("@/lib/albums/cleanup", () => ({ removeObjectsFromAlbums: vi.fn() }));

import { getServerSession } from "@/lib/auth/session";
import { requireAccessContext } from "@/lib/authz";
import { POST as presign } from "@/app/api/objects/presign-upload/route";
import { POST as multipart } from "@/app/api/objects/presign-upload-multipart/route";
import { POST as complete } from "@/app/api/objects/complete-upload/route";
import { POST as upload } from "@/app/api/objects/upload/route";
import { PATCH as reorder } from "@/app/api/objects/reorder/route";
import { POST as metadata } from "@/app/api/objects/update-metadata/route";
import { POST as restore } from "@/app/api/objects/restore/route";
import { POST as purge } from "@/app/api/objects/purge/route";
import { POST as completeUpdate } from "@/app/api/objects/[id]/complete-update/route";
import { PATCH as patchObject } from "@/app/api/objects/[id]/route";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import UploadSession from "@/models/UploadSession";
import OrgUsage from "@/models/OrgUsage";
import { attachToUploadSession, reserveUploadSession } from "@/lib/uploads/session";
import { orgObjectKeyPrefix } from "@/lib/orgs/storage";

const accountId = "permission-account";
const organizationId = "permission-org";
const spaceId = `space_org_${organizationId}`;
const mockedSession = vi.mocked(getServerSession);
const params = { params: Promise.resolve({ id: "000000000000000000000001" }) };

function request(method = "POST", body: object = {}) {
  return new NextRequest(`http://localhost/api/objects?spaceId=${spaceId}`, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

async function setRole(role: SpaceRole) {
  await getDatabase().collection("member").updateOne(
    { userId: accountId, organizationId }, { $set: { role } }, { upsert: true },
  );
}

describe("generic storage mutation permissions", () => {
  beforeEach(async () => {
    send.mockReset(); sign.mockReset(); publish.mockReset();
    mockedSession.mockResolvedValue({
      user: { id: accountId }, session: { id: "permission-session" },
    } as unknown as NonNullable<Awaited<ReturnType<typeof getServerSession>>>);
    await Space.create({ _id: spaceId, type: "organization", organizationId, createdByAccountId: accountId });
    await setRole("guest");
  });

  const routes: Array<[string, string, (req: NextRequest) => Promise<Response>]> = [
    ["presign", "POST", presign], ["multipart presign", "POST", multipart],
    ["complete upload", "POST", complete], ["legacy upload", "POST", upload],
    ["reorder", "PATCH", reorder], ["metadata", "POST", metadata],
    ["restore", "POST", restore], ["purge", "POST", purge],
    ["complete update", "POST", (req) => completeUpdate(req, params)],
    ["patch object", "PATCH", (req) => patchObject(req, params)],
  ];

  it.each(routes)("rejects a guest calling %s before storage work", async (_name, method, handler) => {
    const response = await handler(request(method));
    expect(response.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(await StorageObject.countDocuments({})).toBe(0);
  });

  it("continues to authorize guest reads and member writes, but not member deletion", async () => {
    await expect(requireAccessContext(request(), "read")).resolves.toMatchObject({ role: "guest" });
    await setRole("member");
    await expect(requireAccessContext(request(), "write")).resolves.toMatchObject({ role: "member" });
    await expect(requireAccessContext(request(), "delete")).rejects.toMatchObject({ status: 403 });
    expect((await purge(request())).status).toBe(403);
    await setRole("admin");
    await expect(requireAccessContext(request(), "delete")).resolves.toMatchObject({ role: "admin" });
  });

  it("preserves an existing object for guests and allows a member to reorder it", async () => {
    const bucket = await Bucket.create({ systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" });
    const object = await StorageObject.create({ bucketId: bucket._id, spaceId, createdByAccountId: accountId, key: "workspaces/permission-org/file", size: 10, b2FileId: "test", position: 1 });
    const body = { bucketId: String(bucket._id), items: [{ id: String(object._id), position: 9 }] };
    expect((await reorder(request("PATCH", body))).status).toBe(403);
    expect((await StorageObject.findById(object._id))?.position).toBe(1);
    await setRole("member");
    expect((await reorder(request("PATCH", body))).status).toBe(200);
    expect((await StorageObject.findById(object._id))?.position).toBe(9);
  });

  it("does not derive a PUT key from a binned Photos filename", async () => {
    await setRole("member");
    const bucket = await Bucket.create({ systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" });
    const prefix = orgObjectKeyPrefix(organizationId);
    await StorageObject.create({
      bucketId: bucket._id, spaceId, productId: "photos", createdByAccountId: accountId,
      key: `${prefix}known`, size: 16, b2FileId: "b2-existing", isEncrypted: true,
      deletedAt: new Date(),
    });
    const response = await presign(request("POST", {
      bucketId: String(bucket._id), prefix, fileName: "known", fileSize: 16,
    }));
    expect(response.status).toBe(200);
    const { objectKey } = await response.json();
    expect(objectKey).toMatch(/^workspaces\/permission-org\/objects\/[0-9a-f]{32}$/u);
    expect(objectKey).not.toBe(`${prefix}known`);
    expect(sign).toHaveBeenCalledOnce();
  });

  it("does not derive multipart chunk keys from a referenced name", async () => {
    await setRole("member");
    const bucket = await Bucket.create({ systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" });
    const prefix = orgObjectKeyPrefix(organizationId);
    await StorageObject.create({
      bucketId: bucket._id, spaceId, createdByAccountId: accountId,
      key: `${prefix}other`, size: 16, b2FileId: "b2-existing", isEncrypted: true,
      chunks: [{ index: 0, key: `${prefix}known-chunk-0`, size: 16 }],
    });
    const response = await multipart(request("POST", {
      bucketId: String(bucket._id), prefix, fileName: "known", fileSize: 16,
      chunkCount: 1, chunkSize: 2 * 1024 * 1024,
    }));
    expect(response.status).toBe(200);
    const { fileId, urls } = await response.json();
    expect(fileId).toMatch(/^workspaces\/permission-org\/objects\/[0-9a-f]{32}$/u);
    expect(urls[0].key).toBe(`${fileId}-chunk-0`);
    expect(urls[0].key).not.toBe(`${prefix}known-chunk-0`);
    expect(sign).toHaveBeenCalledOnce();
  });

  it.each([0, 0.5, 4097, "100", null])(
    "rejects invalid multipart chunkCount %s before signing",
    async (chunkCount) => {
      await setRole("member");
      const response = await multipart(request("POST", {
        bucketId: "bucket", fileSize: 16, chunkCount,
      }));
      expect(response.status).toBe(400);
      expect(sign).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid file sizes and chunk size before signing", async () => {
    await setRole("member");
    expect((await presign(request("POST", {
      bucketId: "bucket", fileSize: -1,
    }))).status).toBe(400);
    expect((await multipart(request("POST", {
      bucketId: "bucket", fileSize: 16, chunkCount: 1, chunkSize: "NaN",
    }))).status).toBe(400);
    expect(sign).not.toHaveBeenCalled();
  });

  it("still presigns fresh encrypted single and chunked uploads", async () => {
    await setRole("member");
    sign.mockResolvedValue("https://upload.example.test/presigned");
    const bucket = await Bucket.create({ systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" });
    const prefix = orgObjectKeyPrefix(organizationId);
    const single = await presign(request("POST", {
      bucketId: String(bucket._id), prefix, fileName: "fresh-single", fileSize: 16,
      fileType: "application/octet-stream",
    }));
    expect(single.status).toBe(200);
    expect((await single.json()).objectKey).toMatch(/^workspaces\/permission-org\/objects\/[0-9a-f]{32}$/u);
    const chunked = await multipart(request("POST", {
      bucketId: String(bucket._id), prefix, fileName: "fresh-chunked", fileSize: 4_000_000,
      fileType: "application/octet-stream", chunkCount: 2, chunkSize: 2 * 1024 * 1024,
    }));
    expect(chunked.status).toBe(200);
    expect((await chunked.json()).urls).toHaveLength(2);
    expect(sign).toHaveBeenCalledTimes(3);
  });

  it("requires the owned pending reservation to refresh a single-file URL", async () => {
    await setRole("member");
    sign.mockResolvedValue("https://upload.example.test/presigned");
    const bucket = await Bucket.create({ systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" });
    const prefix = orgObjectKeyPrefix(organizationId);
    const body = { bucketId: String(bucket._id), prefix, fileSize: 16 };
    const first = await presign(request("POST", body));
    expect(first.status).toBe(200);
    const { sessionId, objectKey } = await first.json();
    expect(sessionId).toMatch(/^[0-9a-f]{24}$/);
    expect(objectKey).toMatch(/^workspaces\/permission-org\/objects\/[0-9a-f]{32}$/u);

    const another = await presign(request("POST", body));
    expect(another.status).toBe(200);
    expect((await another.json()).objectKey).not.toBe(objectKey);
    expect((await presign(request("POST", { ...body, sessionId: "000000000000000000000001" }))).status).toBe(409);
    expect(sign).toHaveBeenCalledTimes(2);
    const refreshed = await presign(request("POST", { ...body, sessionId, fileName: "tampered-name" }));
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json()).objectKey).toBe(objectKey);
    expect(sign).toHaveBeenCalledTimes(3);

    await getDatabase().collection("member").insertOne({
      userId: "other-member", organizationId, role: "member",
    });
    mockedSession.mockResolvedValue({
      user: { id: "other-member" }, session: { id: "other-session" },
    } as unknown as NonNullable<Awaited<ReturnType<typeof getServerSession>>>);
    expect((await presign(request("POST", { ...body, sessionId }))).status).toBe(409);
    expect(sign).toHaveBeenCalledTimes(3);

    mockedSession.mockResolvedValue({
      user: { id: accountId }, session: { id: "permission-session" },
    } as unknown as NonNullable<Awaited<ReturnType<typeof getServerSession>>>);
    await UploadSession.updateOne({ _id: sessionId }, { $set: { status: "completed" } });
    expect((await presign(request("POST", { ...body, sessionId }))).status).toBe(409);
  });

  it("requires a pending parent reservation for thumbnail presigning", async () => {
    await setRole("member");
    sign.mockResolvedValue("https://upload.example.test/presigned");
    const bucket = await Bucket.create({ systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" });
    const prefix = orgObjectKeyPrefix(organizationId);
    const main = await presign(request("POST", {
      bucketId: String(bucket._id), prefix, fileSize: 16,
    }));
    expect(main.status).toBe(200);
    const { objectKey, sessionId } = await main.json();
    const body = {
      bucketId: String(bucket._id), prefix, fileSize: 16, variant: "thumbnail",
    };
    expect((await presign(request("POST", body))).status).toBe(400);
    expect((await presign(request("POST", { ...body, parentSessionId: "000000000000000000000001" }))).status).toBe(409);
    expect(sign).toHaveBeenCalledTimes(1);
    const thumbnail = await presign(request("POST", { ...body, parentSessionId: sessionId }));
    expect(thumbnail.status).toBe(200);
    expect((await thumbnail.json()).objectKey).toBe(`${objectKey}-thumb`);
    const optimized = await presign(request("POST", {
      ...body, parentSessionId: sessionId, variant: "optimized",
    }));
    expect(optimized.status).toBe(200);
    expect((await optimized.json()).objectKey).toBe(`${objectKey}-optimized`);
    expect(await UploadSession.countDocuments({ bucketId: bucket._id })).toBe(1);
    await UploadSession.updateOne({ _id: sessionId }, { $set: { status: "completed" } });
    expect((await presign(request("POST", { ...body, parentSessionId: sessionId }))).status).toBe(409);
  });

  it("requires the pending reservation to refresh multipart URLs", async () => {
    await setRole("member");
    sign.mockResolvedValue("https://upload.example.test/presigned");
    const bucket = await Bucket.create({ systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" });
    const body = {
      bucketId: String(bucket._id), prefix: orgObjectKeyPrefix(organizationId),
      fileSize: 4_000_000, chunkCount: 2,
      chunkSize: 2 * 1024 * 1024,
    };
    const first = await multipart(request("POST", body));
    expect(first.status).toBe(200);
    const { sessionId, fileId } = await first.json();
    expect(sign).toHaveBeenCalledTimes(2);
    const another = await multipart(request("POST", body));
    expect(another.status).toBe(200);
    expect((await another.json()).fileId).not.toBe(fileId);
    expect(sign).toHaveBeenCalledTimes(4);
    const refreshed = await multipart(request("POST", { ...body, sessionId }));
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json()).fileId).toBe(fileId);
    expect(sign).toHaveBeenCalledTimes(6);
  });

  it("issues distinct keys for concurrent requests carrying the same filename", async () => {
    await setRole("member");
    sign.mockResolvedValue("https://upload.example.test/presigned");
    const bucket = await Bucket.create({ systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" });
    const body = {
      bucketId: String(bucket._id), prefix: orgObjectKeyPrefix(organizationId),
      fileName: "same-key", fileSize: 16,
    };
    const responses = await Promise.all([
      presign(request("POST", body)),
      presign(request("POST", body)),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const keys = await Promise.all(responses.map(async (response) => (await response.json()).objectKey));
    expect(new Set(keys).size).toBe(2);
    expect(keys.every((key) => /^[\s\S]*\/[0-9a-f]{32}$/u.test(key))).toBe(true);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(await UploadSession.countDocuments({ bucketId: bucket._id })).toBe(2);
  });

  it("atomically claims a physical key across different logical uploads", async () => {
    const bucket = await Bucket.create({ systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" });
    const prefix = orgObjectKeyPrefix(organizationId);
    const shared = `${prefix}shared-variant`;
    const [first, second] = await Promise.all([
      reserveUploadSession({
        userId: accountId, spaceId, bucketId: bucket._id, fileId: `${prefix}first`,
        keys: [`${prefix}first`, shared],
      }),
      reserveUploadSession({
        userId: accountId, spaceId, bucketId: bucket._id, fileId: `${prefix}second`,
        keys: [`${prefix}second`, shared],
      }),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await UploadSession.countDocuments({ bucketId: bucket._id })).toBe(1);
    const index = (await UploadSession.collection.indexes()).find(
      (entry) => entry.name === "bucketId_1_keys_1",
    );
    expect(index?.unique).toBe(true);
  });

  it("atomically claims a secondary key for only one parent upload", async () => {
    const bucket = await Bucket.create({ systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" });
    const prefix = orgObjectKeyPrefix(organizationId);
    const parents = await Promise.all(["first", "second"].map(async (suffix) => {
      const fileId = `${prefix}${suffix}`;
      const sessionId = await reserveUploadSession({
        userId: accountId, spaceId, bucketId: bucket._id, fileId, keys: [fileId],
      });
      if (!sessionId) throw new Error("Could not reserve parent");
      return { fileId, sessionId };
    }));
    const claimedKey = `${prefix}preview`;
    const claims = await Promise.all(parents.map((parent) =>
      attachToUploadSession({
        userId: accountId, spaceId, bucketId: bucket._id,
        parentFileId: parent.fileId, parentSessionId: parent.sessionId,
        key: claimedKey,
      }),
    ));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await UploadSession.countDocuments({
      bucketId: bucket._id, keys: claimedKey,
    })).toBe(1);
  });

  async function completionFixture(reservationOverrides: Record<string, unknown> = {}) {
    await setRole("member");
    const bucket = await Bucket.create({ systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" });
    const objectKey = `${orgObjectKeyPrefix(organizationId)}reserved`;
    const reservation = await UploadSession.create({
      userId: accountId,
      spaceId,
      bucketId: bucket._id,
      fileId: objectKey,
      keys: [objectKey, `${objectKey}-thumb`],
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
      ...reservationOverrides,
    });
    const body = {
      objectKey, bucketId: String(bucket._id), sessionId: String(reservation._id),
      size: 16, contentType: "application/octet-stream", originalContentType: "image/png",
      isEncrypted: true, encryptedDEK: "wrapped-key", encryptedName: "encrypted-name",
      wrappedBy: "space", spaceKeyWrapIv: "wrap-iv", spaceKeyVersion: 1,
    };
    return { bucket, body, reservation };
  }

  it("requires an exact account and Space-bound upload reservation before B2 work", async () => {
    const { body, reservation } = await completionFixture({ spaceId: "space_org_other" });
    expect((await complete(request("POST", body))).status).toBe(409);
    await UploadSession.updateOne(
      { _id: reservation._id },
      { $set: { spaceId, userId: "another-account" } },
    );
    expect((await complete(request("POST", body))).status).toBe(409);
    expect((await complete(request("POST", { ...body, sessionId: undefined }))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects unclaimed variants before B2 work", async () => {
    const { body } = await completionFixture();
    const response = await complete(request("POST", {
      ...body, thumbnail: `${body.objectKey}-unclaimed`,
    }));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("unclaimed_upload_key");
    expect(send).not.toHaveBeenCalled();
  });

  it("does not overwrite an existing ciphertext object through completion", async () => {
    const { bucket, body } = await completionFixture();
    await StorageObject.create({
      bucketId: bucket._id, spaceId, productId: "drive",
      createdByAccountId: accountId, key: body.objectKey,
      size: 8, b2FileId: "existing", isEncrypted: true,
    });
    const response = await complete(request("POST", body));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("object_key_conflict");
    expect((await StorageObject.findOne({ key: body.objectKey }))?.size).toBe(8);
    expect(send).not.toHaveBeenCalled();
  });

  it("finalizes a claimed encrypted object and closes its reservation", async () => {
    const { body, reservation } = await completionFixture();
    await OrgUsage.create({ orgId: organizationId, accountId: `org:${organizationId}` });
    send.mockResolvedValue({ VersionId: "ciphertext-version", ContentLength: 16 });
    const response = await complete(request("POST", body));
    expect(response.status).toBe(201);
    const object = await StorageObject.findOne({ key: body.objectKey }).lean();
    expect(object).toMatchObject({
      spaceId, productId: "drive", isEncrypted: true, size: 16,
    });
    expect((await UploadSession.findById(reservation._id))?.status).toBe("completed");
    expect(send).toHaveBeenCalledOnce();
    expect((await complete(request("POST", body))).status).toBe(200);
    expect(await StorageObject.countDocuments({ key: body.objectKey })).toBe(1);
    expect(send).toHaveBeenCalledOnce();
  });
});

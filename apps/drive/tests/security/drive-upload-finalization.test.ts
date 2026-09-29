import { NextRequest } from "next/server";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Space, getDatabase } from "@xenode/database";

const { send, publish } = vi.hoisted(() => ({ send: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/b2/client", () => ({ getS3Client: () => ({ send }) }));
vi.mock("@/lib/realtime/publish", () => ({
  publishSyncEvent: publish, parentPrefixForKey: vi.fn(), toSyncObjectSnapshot: vi.fn(),
}));

import { POST } from "@/app/api/objects/complete-upload/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import UploadSession from "@/models/UploadSession";
import StorageObject from "@/models/StorageObject";
import Usage from "@/models/Usage";
import OrgUsage from "@/models/OrgUsage";
import { createUsage, makeUserId } from "../helpers/factories";
import { recalculateUsage } from "@/lib/metering/usage";

function request(body: object, spaceId?: string) {
  return new NextRequest(`http://localhost/api/objects/complete-upload${spaceId ? `?spaceId=${spaceId}` : ""}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

async function fixture(options: { quota?: number; usage?: boolean; organization?: boolean; chunks?: boolean } = {}) {
  const accountId = makeUserId();
  const organizationId = "finalization-org";
  const spaceId = options.organization ? `space_org_${organizationId}` : `space_personal_${accountId}`;
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id: accountId }, session: { id: "finalization-session" },
  } as unknown as NonNullable<Awaited<ReturnType<typeof getServerSession>>>);
  await Space.create({
    _id: spaceId, type: options.organization ? "organization" : "personal",
    ownerAccountId: options.organization ? undefined : accountId,
    organizationId: options.organization ? organizationId : undefined, createdByAccountId: accountId,
  });
  if (options.organization) {
    await getDatabase().collection("member").insertOne({ userId: accountId, organizationId, role: "member" });
  }
  const bucket = await Bucket.create({
    systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage",
  });
  if (options.usage !== false) {
    if (options.organization) {
      await OrgUsage.create({ orgId: organizationId, accountId: `org:${organizationId}`, storageLimitBytes: options.quota ?? 10_000 });
    } else {
      await createUsage({ userId: accountId, storageLimitBytes: options.quota ?? 10_000 });
    }
  }
  const key = options.organization ? `workspaces/${organizationId}/objects/opaque` : `users/${accountId}/opaque`;
  const chunks = options.chunks ? [
    { index: 0, key: `${key}-chunk-0`, size: 60 },
    { index: 1, key: `${key}-chunk-1`, size: 40 },
  ] : undefined;
  const upload = await UploadSession.create({
    userId: accountId, spaceId, bucketId: bucket._id, fileId: key,
    keys: [key, `${key}-optimized`, `${key}-thumb`, ...(chunks?.map((chunk) => chunk.key) ?? [])],
    expiresAt: new Date(Date.now() + 60_000),
  });
  const body = {
    objectKey: key, bucketId: String(bucket._id), sessionId: String(upload._id), size: 100,
    contentType: "application/octet-stream", isEncrypted: true, encryptedDEK: "wrapped-key",
    encryptedName: "encrypted-name", iv: options.chunks ? undefined : "iv",
    wrappedBy: "space", spaceKeyWrapIv: "wrap-iv", spaceKeyVersion: 1,
    isChunked: options.chunks || undefined, chunks,
    chunkCount: chunks?.length, chunkIvs: chunks ? JSON.stringify(["iv0", "iv1"]) : undefined,
  };
  send.mockImplementation(async (command: HeadObjectCommand) => {
    const lengths: Record<string, number> = { [key]: 100, [`${key}-optimized`]: 30, [`${key}-thumb`]: 20 };
    for (const chunk of chunks ?? []) lengths[chunk.key] = chunk.size;
    return { ContentLength: lengths[command.input.Key!], VersionId: "ciphertext-version" };
  });
  return { accountId, organizationId, spaceId, bucket, upload, body };
}

async function expectPendingUnmetered(input: Awaited<ReturnType<typeof fixture>>) {
  expect(await StorageObject.countDocuments({})).toBe(0);
  expect((await UploadSession.findById(input.upload._id))?.status).toBe("pending");
  expect((await Usage.findOne({ userId: input.accountId }))?.totalStorageBytes ?? 0).toBe(0);
  expect((await OrgUsage.findOne({ orgId: input.organizationId }))?.totalStorageBytes ?? 0).toBe(0);
  expect(publish).not.toHaveBeenCalled();
}

describe("Drive verified transactional upload finalization", () => {
  beforeEach(() => { send.mockReset(); publish.mockReset(); });

  it.each([99, undefined, -1, Number.MAX_SAFE_INTEGER + 1])("rejects invalid/mismatched B2 length %s before metadata or billing", async (length) => {
    const input = await fixture();
    send.mockResolvedValue({ ContentLength: length });
    const response = await POST(request(input.body));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("upload_size_mismatch");
    await expectPendingUnmetered(input);
  });

  it("verifies and meters the main blob and both variants, then retries without B2 or counter writes", async () => {
    const input = await fixture();
    const body = { ...input.body, optimizedKey: `${input.body.objectKey}-optimized`, thumbnail: `${input.body.objectKey}-thumb` };
    const response = await POST(request(body));
    expect(response.status).toBe(201);
    const saved = (await response.json()).object;
    expect(saved).toMatchObject({ _id: String(input.upload._id), size: 100, optimizedSize: 30, thumbnailSize: 20 });
    expect((await Usage.findOne({ userId: input.accountId }))?.toObject()).toMatchObject({
      totalStorageBytes: 150, totalObjects: 1, uploadCount: 1,
    });
    expect((await Bucket.findById(input.bucket._id))?.toObject()).toMatchObject({ totalSizeBytes: 150, objectCount: 1 });
    send.mockClear();
    expect((await POST(request(body))).status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledOnce();
    expect((await Usage.findOne({ userId: input.accountId }))?.totalStorageBytes).toBe(150);
  });

  it("rolls back when variants push the upload over quota", async () => {
    const input = await fixture({ quota: 120 });
    const response = await POST(request({
      ...input.body, optimizedKey: `${input.body.objectKey}-optimized`, thumbnail: `${input.body.objectKey}-thumb`,
    }));
    expect(response.status).toBe(402);
    expect(send.mock.calls.every(([command]) => command instanceof HeadObjectCommand)).toBe(true);
    await expectPendingUnmetered(input);
    expect((await Bucket.findById(input.bucket._id))?.objectCount).toBe(0);
  });

  it.each([false, true])("requires initialized quota state (organization=%s)", async (organization) => {
    const input = await fixture({ usage: false, organization });
    const response = await POST(request(input.body, input.spaceId));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("usage_not_initialized");
    await expectPendingUnmetered(input);
    expect(await Usage.countDocuments({})).toBe(0);
    expect(await OrgUsage.countDocuments({})).toBe(0);
  });

  it("charges the organization's authoritative quota owner including variant bytes", async () => {
    const input = await fixture({ organization: true });
    const response = await POST(request({ ...input.body, thumbnail: `${input.body.objectKey}-thumb` }, input.spaceId));
    expect(response.status).toBe(201);
    expect((await OrgUsage.findOne({ orgId: input.organizationId }))?.toObject()).toMatchObject({ totalStorageBytes: 120, totalObjects: 1 });
    expect(await Usage.countDocuments({ userId: input.accountId })).toBe(0);
  });

  it("rolls back metadata and usage when the bucket disappears during B2 verification", async () => {
    const input = await fixture();
    send.mockImplementation(async () => {
      await Bucket.deleteOne({ _id: input.bucket._id });
      return { ContentLength: 100 };
    });
    const response = await POST(request(input.body));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("bucket_missing");
    await expectPendingUnmetered(input);
  });

  it("commits concurrent completion once and returns the exact object to both callers", async () => {
    const input = await fixture();
    const responses = await Promise.all([POST(request(input.body)), POST(request(input.body))]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    for (const response of responses) expect((await response.json()).object._id).toBe(String(input.upload._id));
    expect(await StorageObject.countDocuments({})).toBe(1);
    expect((await Usage.findOne({ userId: input.accountId }))?.toObject()).toMatchObject({
      totalStorageBytes: 100, totalObjects: 1, uploadCount: 1,
    });
    expect((await Bucket.findById(input.bucket._id))?.objectCount).toBe(1);
    expect(publish).toHaveBeenCalledOnce();
  });

  it("enforces shared quota across different uploads racing to finalize", async () => {
    const input = await fixture({ quota: 100 });
    const key = `${input.body.objectKey}-second`;
    const second = await UploadSession.create({
      userId: input.accountId, spaceId: input.spaceId, bucketId: input.bucket._id, fileId: key,
      keys: [key], expiresAt: new Date(Date.now() + 60_000),
    });
    send.mockResolvedValue({ ContentLength: 100 });
    const responses = await Promise.all([
      POST(request(input.body)), POST(request({ ...input.body, objectKey: key, sessionId: String(second._id) })),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 402]);
    expect(await StorageObject.countDocuments({})).toBe(1);
    expect(await UploadSession.countDocuments({ status: "completed" })).toBe(1);
    expect(await UploadSession.countDocuments({ status: "pending" })).toBe(1);
    expect((await Usage.findOne({ userId: input.accountId }))?.totalStorageBytes).toBe(100);
  });

  it("keeps the losing fingerprint upload pending without deleting any winning or losing blob", async () => {
    const input = await fixture();
    await StorageObject.create({
      bucketId: input.bucket._id, productId: "drive", spaceId: input.spaceId,
      createdByAccountId: input.accountId, key: `${input.body.objectKey}-winner`, size: 80,
      b2FileId: "winner", syncContentFp: "same-fingerprint",
    });
    const response = await POST(request({ ...input.body, syncContentFp: "same-fingerprint" }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("object_identity_conflict");
    expect(await StorageObject.countDocuments({})).toBe(1);
    expect((await Usage.findOne({ userId: input.accountId }))?.totalStorageBytes).toBe(0);
    expect((await UploadSession.findById(input.upload._id))?.status).toBe("pending");
    expect(send.mock.calls.every(([command]) => command instanceof HeadObjectCommand)).toBe(true);
  });

  it("verifies each chunk and meters its ciphertext total", async () => {
    const input = await fixture({ chunks: true });
    const response = await POST(request(input.body));
    expect(response.status).toBe(201);
    expect(send).toHaveBeenCalledTimes(2);
    const object = await StorageObject.findById(input.upload._id);
    expect(object?.size).toBe(100);
    expect(object?.chunks?.map((chunk) => chunk.size)).toEqual([60, 40]);
    expect((await Usage.findOne({ userId: input.accountId }))?.totalStorageBytes).toBe(100);
  });

  it("rejects a chunk whose stored length differs from its declared size", async () => {
    const input = await fixture({ chunks: true });
    send.mockResolvedValue({ ContentLength: 60 });
    const response = await POST(request(input.body));
    expect(response.status).toBe(409);
    await expectPendingUnmetered(input);
  });

  it.each(["duplicate-index", "duplicate-key", "wrong-total", "missing-iv", "too-many-chunks"])("rejects malformed chunk layout %s before B2 reads", async (problem) => {
    const input = await fixture({ chunks: true });
    const body = structuredClone(input.body);
    if (problem === "duplicate-index") body.chunks![1].index = 0;
    if (problem === "duplicate-key") body.chunks![1].key = body.chunks![0].key;
    if (problem === "wrong-total") body.size = 101;
    if (problem === "missing-iv") body.chunkIvs = '["iv0"]';
    if (problem === "too-many-chunks") body.chunkCount = 4097;
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
    await expectPendingUnmetered(input);
  });

  it("returns a missing variant error without creating metadata or consuming quota", async () => {
    const input = await fixture();
    send.mockResolvedValueOnce({ ContentLength: 100 }).mockRejectedValueOnce(new Error("not found"));
    const response = await POST(request({ ...input.body, optimizedKey: `${input.body.objectKey}-optimized` }));
    expect(response.status).toBe(404);
    await expectPendingUnmetered(input);
  });

  it("does not rewrite plan state during finalization", async () => {
    const input = await fixture();
    await Usage.updateOne({ userId: input.accountId }, {
      $set: { plan: "pro", planExpiresAt: new Date(0), storageLimitBytes: 1000, autopayActive: true },
    });
    expect((await POST(request(input.body))).status).toBe(201);
    expect((await Usage.findOne({ userId: input.accountId }))?.toObject()).toMatchObject({
      plan: "pro", planExpiresAt: new Date(0), storageLimitBytes: 1000, autopayActive: true,
    });
  });

  it("recalculates all products' variant and retained bytes without counting shared original content twice", async () => {
    const input = await fixture();
    expect((await POST(request({
      ...input.body, optimizedKey: `${input.body.objectKey}-optimized`, thumbnail: `${input.body.objectKey}-thumb`,
    }))).status).toBe(201);
    await StorageObject.updateOne({ _id: input.upload._id }, { $set: { versions: [
      { versionId: "shared", key: input.body.objectKey, size: 100, sharesCurrentContent: true, createdAt: new Date(), createdBy: input.accountId },
      { versionId: "retained", key: `${input.body.objectKey}-retained`, size: 20, createdAt: new Date(), createdBy: input.accountId },
    ] } });
    await getDatabase().collection("storageobjects").insertOne({
      productId: "photos", spaceId: input.spaceId, bucketId: input.bucket._id,
      key: `users/${input.accountId}/photo`, size: 50, thumbnailSize: 10,
    });
    const usage = await recalculateUsage(input.accountId);
    expect(usage?.totalStorageBytes).toBe(230);
    expect(usage?.totalObjects).toBe(2);
  });
});

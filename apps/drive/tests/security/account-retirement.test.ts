import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDatabase, ProductSession } from "@xenode/database";
import { ensurePersonalSpace } from "@xenode/spaces/repository";

const { deleted } = vi.hoisted(() => ({ deleted: vi.fn() }));
vi.mock("@/lib/b2/objects", () => ({ deleteObjects: deleted }));
vi.mock("@/lib/admin/session", () => ({
  getAdminSession: vi.fn(async () => ({ role: "super_admin" })),
}));

import { DELETE as adminDELETE } from "@/app/api/admin/users/[userId]/route";
import { GET as retireCron } from "@/app/api/cron/purge-orgs/route";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import Usage from "@/models/Usage";

/** An account as Better Auth's Mongo adapter stores it: ObjectId references. */
async function account() {
  const accountId = new Types.ObjectId().toHexString();
  const ref = new Types.ObjectId(accountId);
  const db = getDatabase();
  await db.collection("user").insertOne({ _id: ref, email: `${accountId}@example.com` });
  await db.collection("session").insertOne({ userId: ref, token: `t-${accountId}`, expiresAt: new Date(Date.now() + 60_000) });
  await db.collection("account").insertOne({ userId: ref, providerId: "credential", password: "hash" });
  await db.collection("passkey").insertOne({ userId: ref, credentialID: `cred-${accountId}` });
  await db.collection("twoFactor").insertOne({ userId: ref, secret: "encrypted" });
  await db.collection("userVaults").insertOne({ accountId, envelope: "sealed" });
  await ProductSession.create({
    sessionId: `ps-${accountId}`, accountId, productId: "drive", issuerSessionId: `sid-${accountId}`,
    clientId: "drive", authenticatedAt: new Date(), sessionVersion: 1, expiresAt: new Date(Date.now() + 60_000),
  });
  const space = await ensurePersonalSpace(accountId);
  const bucket = await Bucket.create({
    name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage", storageRegion: "asia",
    objectCount: 1, totalSizeBytes: 100,
  });
  await Usage.create({ userId: accountId, totalStorageBytes: 100, totalObjects: 1 });
  const object = await StorageObject.create({
    bucketId: bucket._id, spaceId: space._id, createdByAccountId: accountId,
    key: `users/${accountId}/ciphertext`, size: 100, b2FileId: "f", isEncrypted: true, encryptedDEK: "wrapped",
  });
  return { accountId, ref, spaceId: space._id, object };
}

const remove = (accountId: string) =>
  adminDELETE(new NextRequest(`http://localhost/api/admin/users/${accountId}`, { method: "DELETE" }), {
    params: Promise.resolve({ userId: accountId }),
  });

describe("admin account deletion", () => {
  afterEach(() => {
    deleted.mockReset();
    delete process.env.CRON_SECRET;
  });

  it("ends identity now and purges storage through the pipeline", async () => {
    const { accountId, ref, spaceId, object } = await account();
    const response = await remove(accountId);
    expect(response.status).toBe(202);

    const db = getDatabase();
    expect(await db.collection("user").countDocuments({ _id: ref })).toBe(0);
    for (const name of ["session", "account", "passkey", "twoFactor"]) {
      expect(await db.collection(name).countDocuments({ userId: ref })).toBe(0);
    }
    expect(await db.collection("userVaults").countDocuments({ accountId })).toBe(0);
    expect(await ProductSession.countDocuments({ accountId })).toBe(0);
    expect((await db.collection("spaces").findOne({ _id: spaceId as never }))?.status).toBe("deleted");
    // Bytes stay charged until the ciphertext is really gone.
    expect((await StorageObject.findById(object._id).lean())?.deletedAt).toBeInstanceOf(Date);
    expect((await Usage.findOne({ userId: accountId }).lean())?.totalStorageBytes).toBe(100);
    expect(deleted).not.toHaveBeenCalled();

    process.env.CRON_SECRET = "retire-test";
    const sweep = await retireCron(new NextRequest("http://localhost/api/cron/purge-orgs", {
      headers: { authorization: "Bearer retire-test" },
    }));
    expect(sweep.status).toBe(200);
    expect((await sweep.json()).purgedAccounts).toBe(1);
    expect(deleted).toHaveBeenCalledWith("xenode-drive-storage", [`users/${accountId}/ciphertext`]);
    expect(await StorageObject.countDocuments({ spaceId })).toBe(0);
    expect(await Usage.countDocuments({ userId: accountId })).toBe(0);
    expect(await db.collection("spaces").countDocuments({ _id: spaceId as never })).toBe(0);
  });

  it("refuses while the account belongs to an organization", async () => {
    const { accountId, ref, object } = await account();
    await getDatabase().collection("member").insertOne({ organizationId: "org_x", userId: accountId, role: "member" });
    const response = await remove(accountId);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("organization_membership");
    expect(await getDatabase().collection("user").countDocuments({ _id: ref })).toBe(1);
    expect((await StorageObject.findById(object._id).lean())?.deletedAt).toBeUndefined();
  });

  it("refuses while another product still stores the account's data", async () => {
    const { accountId, spaceId, object } = await account();
    await StorageObject.collection.insertOne({
      productId: "photos", spaceId, bucketId: object.bucketId, key: `users/${accountId}/photo`, size: 1,
    });
    const response = await remove(accountId);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("foreign_product_storage");
    expect(await ProductSession.countDocuments({ accountId })).toBe(1);
  });
});

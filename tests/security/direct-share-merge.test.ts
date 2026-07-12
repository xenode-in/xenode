import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as listGET, POST as createPOST } from "@/app/api/direct-shares/route";
import { PATCH as sharePATCH } from "@/app/api/direct-shares/[id]/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import DirectShare from "@/models/DirectShare";
import mongoose from "mongoose";

const mockedGetServerSession = vi.mocked(getServerSession);

function mockSession(userId: string) {
  mockedGetServerSession.mockResolvedValue({
    user: { id: userId, email: `${userId}@e.com`, name: userId, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
    session: { id: `s-${userId}`, userId, token: `t-${userId}`, createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
  } as unknown as Awaited<ReturnType<typeof getServerSession>>);
}

let bucketSeq = 0;
async function makeObject(overrides: Record<string, unknown> = {}) {
  bucketSeq += 1;
  const bucket = await Bucket.create({
    userId: "owner_1",
    ownerScope: "personal",
    name: `drive-${bucketSeq}`,
    b2BucketId: `b2-drive-${bucketSeq}`,
  });
  return StorageObject.create({
    bucketId: bucket._id,
    userId: "owner_1",
    ownerScope: "personal",
    key: "users/owner_1/a.bin",
    size: 100,
    contentType: "text/plain",
    mediaCategory: "document",
    b2FileId: "f",
    isEncrypted: true,
    encryptedDEK: "wrapped",
    ...overrides,
  });
}

async function makeShare(
  objId: mongoose.Types.ObjectId,
  bucketId: mongoose.Types.ObjectId,
  role = "viewer",
) {
  return DirectShare.create({
    objectId: objId,
    bucketId,
    createdBy: "owner_1",
    shareEncryptedDEK: "dek",
    shareKeyIv: "iv",
    recipients: [
      {
        recipientUserId: "member_1",
        recipientEmail: "member_1@e.com",
        wrappedShareKey: "k",
        accessType: role,
        downloadCount: 4,
        lastAccessedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ],
    isRevoked: false,
  });
}

function postBody(objectId: string, recipients: Record<string, unknown>[]) {
  return new NextRequest("http://localhost/api/direct-shares", {
    method: "POST",
    body: JSON.stringify({
      objectId,
      shareEncryptedDEK: "dek",
      shareKeyIv: "iv",
      recipients,
    }),
    headers: { "content-type": "application/json" },
  });
}

const RECIPIENT = {
  recipientUserId: "member_1",
  recipientEmail: "member_1@e.com",
  wrappedShareKey: "k",
  accessType: "viewer",
};

describe("direct-share duplicate prevention", () => {
  afterEach(() => {
    mockedGetServerSession.mockReset();
  });

  it("creates the first share for an object", async () => {
    const obj = await makeObject();
    mockSession("owner_1");

    const res = await createPOST(postBody(String(obj._id), [RECIPIENT]));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.directShareId).toBeTruthy();
    expect(await DirectShare.countDocuments({ objectId: obj._id, isRevoked: false })).toBe(1);
  });

  it("refuses to create a second active share for the same object", async () => {
    const obj = await makeObject();
    const existing = await makeShare(obj._id, obj.bucketId);
    mockSession("owner_1");

    const res = await createPOST(postBody(String(obj._id), [RECIPIENT]));
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.code).toBe("share_exists");
    expect(data.directShareId).toBe(String(existing._id));
    expect(data.recipients).toHaveLength(1);
    expect(data.recipients[0]).toMatchObject({
      recipientUserId: "member_1",
      accessType: "viewer",
      downloadCount: 4,
    });
    expect(await DirectShare.countDocuments({ objectId: obj._id, isRevoked: false })).toBe(1);
  });

  it("allows a new share after the previous one was revoked", async () => {
    const obj = await makeObject();
    const existing = await makeShare(obj._id, obj.bucketId);
    await DirectShare.updateOne({ _id: existing._id }, { isRevoked: true });
    mockSession("owner_1");

    const res = await createPOST(postBody(String(obj._id), [RECIPIENT]));
    expect(res.status).toBe(200);
  });

  it("filters the owner listing by objectId", async () => {
    const objA = await makeObject();
    const objB = await makeObject({ key: "users/owner_1/b.bin" });
    await makeShare(objA._id, objA.bucketId);
    await makeShare(objB._id, objB.bucketId);
    mockSession("owner_1");

    const res = await listGET(
      new NextRequest(`http://localhost/api/direct-shares?objectId=${String(objA._id)}`),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.directShares).toHaveLength(1);
    expect(String(data.directShares[0].objectId._id)).toBe(String(objA._id));
  });

  it("rejects an invalid objectId filter", async () => {
    mockSession("owner_1");
    const res = await listGET(
      new NextRequest("http://localhost/api/direct-shares?objectId=not-an-id"),
    );
    expect(res.status).toBe(400);
  });

  it("merges recipients via PATCH keeping downloadCount and updating roles", async () => {
    const obj = await makeObject();
    const share = await makeShare(obj._id, obj.bucketId);
    mockSession("owner_1");

    const res = await sharePATCH(
      new NextRequest("http://localhost/x", {
        method: "PATCH",
        body: JSON.stringify({
          recipients: [
            {
              recipientUserId: "member_1",
              recipientEmail: "member_1@e.com",
              wrappedShareKey: "k2",
              accessType: "editor",
              downloadCount: 4,
              lastAccessedAt: "2026-01-01T00:00:00.000Z",
            },
            {
              recipientUserId: "member_2",
              recipientEmail: "member_2@e.com",
              wrappedShareKey: "k3",
              accessType: "viewer",
            },
          ],
          shareEncryptedDEK: "dek2",
          shareKeyIv: "iv2",
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: String(share._id) }) },
    );
    expect(res.status).toBe(200);

    const updated = await DirectShare.findById(share._id).lean();
    expect(updated!.recipients).toHaveLength(2);
    const member1 = updated!.recipients.find((r) => r.recipientUserId === "member_1");
    expect(member1).toMatchObject({ accessType: "editor", downloadCount: 4 });
    expect(member1!.lastAccessedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(updated!.shareEncryptedDEK).toBe("dek2");
  });
});

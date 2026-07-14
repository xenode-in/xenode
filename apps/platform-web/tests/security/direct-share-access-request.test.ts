import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as requestPOST } from "@/app/api/direct-shares/[id]/access-request/route";
import { PATCH as decidePATCH } from "@/app/api/direct-shares/access-requests/[reqId]/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import DirectShare from "@/models/DirectShare";
import ShareAccessRequest from "@/models/ShareAccessRequest";
import mongoose from "mongoose";

const mockedGetServerSession = vi.mocked(getServerSession);

function mockSession(userId: string) {
  mockedGetServerSession.mockResolvedValue({
    user: { id: userId, email: `${userId}@e.com`, name: userId, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
    session: { id: `s-${userId}`, userId, token: `t-${userId}`, createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
  } as unknown as Awaited<ReturnType<typeof getServerSession>>);
}

async function makeObject(overrides: Record<string, unknown> = {}) {
  const bucket = await Bucket.create({
    userId: "owner_1",
    ownerScope: "personal",
    name: "drive",
    b2BucketId: "b2-drive",
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

async function makeShare(objId: mongoose.Types.ObjectId, bucketId: mongoose.Types.ObjectId, role = "viewer") {
  return DirectShare.create({
    objectId: objId,
    bucketId,
    createdBy: "owner_1",
    recipients: [
      { recipientUserId: "member_1", recipientEmail: "member_1@e.com", wrappedShareKey: "k", accessType: role, downloadCount: 0 },
    ],
    isRevoked: false,
  });
}

function reqParams(id: string) {
  return { params: Promise.resolve({ id }) };
}
function decideParams(reqId: string) {
  return { params: Promise.resolve({ reqId }) };
}
function body(payload: unknown, method = "POST") {
  return new NextRequest("http://localhost/x", {
    method,
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  });
}

describe("direct-share access requests", () => {
  afterEach(() => {
    mockedGetServerSession.mockReset();
  });

  it("lets a viewer recipient request an upgrade", async () => {
    const obj = await makeObject();
    const share = await makeShare(obj._id, obj.bucketId);
    mockSession("member_1");

    const res = await requestPOST(body({ requestedRole: "editor" }), reqParams(String(share._id)));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.request.requestedRole).toBe("editor");
    expect(await ShareAccessRequest.countDocuments({ directShareId: share._id, status: "pending" })).toBe(1);
  });

  it("rejects a request from a non-recipient", async () => {
    const obj = await makeObject();
    const share = await makeShare(obj._id, obj.bucketId);
    mockSession("intruder_1");

    const res = await requestPOST(body({ requestedRole: "commenter" }), reqParams(String(share._id)));
    expect(res.status).toBe(403);
  });

  it("rejects a request when the recipient already has that access", async () => {
    const obj = await makeObject();
    const share = await makeShare(obj._id, obj.bucketId, "editor");
    mockSession("member_1");

    const res = await requestPOST(body({ requestedRole: "commenter" }), reqParams(String(share._id)));
    expect(res.status).toBe(400);
  });

  it("owner approval flips the recipient role in place", async () => {
    const obj = await makeObject();
    const share = await makeShare(obj._id, obj.bucketId);
    mockSession("member_1");
    await requestPOST(body({ requestedRole: "editor" }), reqParams(String(share._id)));
    const reqRow = await ShareAccessRequest.findOne({ directShareId: share._id });

    mockSession("owner_1");
    const res = await decidePATCH(body({ decision: "approve" }, "PATCH"), decideParams(String(reqRow!._id)));
    expect(res.status).toBe(200);

    const updated = await DirectShare.findById(share._id).lean();
    expect(updated!.recipients[0].accessType).toBe("editor");
  });

  it("forbids a stranger from deciding", async () => {
    const obj = await makeObject();
    const share = await makeShare(obj._id, obj.bucketId);
    mockSession("member_1");
    await requestPOST(body({ requestedRole: "editor" }), reqParams(String(share._id)));
    const reqRow = await ShareAccessRequest.findOne({ directShareId: share._id });

    mockSession("stranger_1");
    const res = await decidePATCH(body({ decision: "approve" }, "PATCH"), decideParams(String(reqRow!._id)));
    expect(res.status).toBe(403);

    const updated = await DirectShare.findById(share._id).lean();
    expect(updated!.recipients[0].accessType).toBe("viewer");
  });
});

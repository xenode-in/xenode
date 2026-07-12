import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as browseGET } from "@/app/api/orgs/[orgId]/objects/browse/route";
import { PATCH as objectPATCH } from "@/app/api/orgs/[orgId]/objects/[objectId]/route";
import { GET as sharesGET } from "@/app/api/orgs/[orgId]/shares/route";
import { POST as commentsPOST } from "@/app/api/objects/[id]/comments/route";
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

async function createOrg(id = "org_1") {
  await mongoose.connection.collection("organization").insertOne({ id, name: "Acme", slug: id, createdAt: new Date(), updatedAt: new Date() });
}
async function addMember(userId: string, role = "member", orgId = "org_1") {
  await mongoose.connection.collection("member").insertOne({ id: `m_${userId}`, userId, organizationId: orgId, role, createdAt: new Date() });
}

async function makeObject(overrides: Record<string, unknown> = {}) {
  const bucket = await Bucket.create({ userId: "org:org_1", ownerScope: "organization", orgId: "org_1", name: "workspace", b2BucketId: "xenode-organization-dev" });
  return StorageObject.create({
    bucketId: bucket._id,
    userId: "org:org_1",
    ownerScope: "organization",
    orgId: "org_1",
    key: "workspaces/org_1/objects/a.bin",
    size: 100,
    contentType: "text/plain",
    mediaCategory: "document",
    b2FileId: "f",
    isEncrypted: true,
    encryptedDEK: "wrapped",
    wrappedBy: "space",
    spaceKeyVersion: 1,
    ...overrides,
  });
}

const p = (orgId = "org_1") => ({ params: Promise.resolve({ orgId }) });

describe("org collaboration browse + star", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("browses recent org objects (cross-bucket, ciphertext name only)", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("member_1");
    await createOrg();
    await addMember("member_1", "member");
    // encryptedName is AES-GCM ciphertext — only decryptable with the space key.
    await makeObject({ encryptedName: "AgEC_ciphertext_blob", isEncrypted: true });

    const res = await browseGET(new NextRequest("http://localhost/x?scope=recent"), p());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.objects).toHaveLength(1);
    expect(body.objects[0].size).toBe(100);
    // The client needs the ciphertext to decrypt the name locally.
    expect(body.objects[0].encryptedName).toBe("AgEC_ciphertext_blob");
    // The server never decrypts or returns key material.
    expect(body.objects[0].name).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("wrapped");
    expect(JSON.stringify(body)).not.toContain("encryptedDEK");
  });

  it("filters favorites to starred and toggles star via PATCH", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("member_1");
    await createOrg();
    await addMember("member_1", "member");
    const obj = await makeObject();

    // Not starred yet → favorites empty.
    let fav = await (await browseGET(new NextRequest("http://localhost/x?scope=favorites"), p())).json();
    expect(fav.objects).toHaveLength(0);

    // Star it.
    const patch = await objectPATCH(
      new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ starred: true }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ orgId: "org_1", objectId: obj._id.toString() }) },
    );
    expect(patch.status).toBe(200);

    fav = await (await browseGET(new NextRequest("http://localhost/x?scope=favorites"), p())).json();
    expect(fav.objects).toHaveLength(1);
    expect(fav.objects[0].starred).toBe(true);
  });

  it("forbids guests from browsing org objects", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("guest_1");
    await createOrg();
    await addMember("guest_1", "guest");

    const res = await browseGET(new NextRequest("http://localhost/x?scope=recent"), p());
    expect(res.status).toBe(403);
  });

  it("surfaces direct shares to a guest via shared-with-me", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("guest_1");
    await createOrg();
    await addMember("guest_1", "guest");
    const obj = await makeObject();
    await DirectShare.create({
      objectId: obj._id,
      bucketId: obj.bucketId,
      createdBy: "owner_1",
      recipients: [
        { recipientUserId: "guest_1", recipientEmail: "g@e.com", wrappedShareKey: "k", accessType: "view", downloadCount: 0 },
      ],
      isRevoked: false,
    });

    const res = await sharesGET(new NextRequest("http://localhost/x?scope=with-me"), p());
    const body = await res.json();
    expect(res.status).toBe(200); // guests may view what's shared with them
    expect(body.shares).toHaveLength(1);
    expect(body.shares[0].type).toBe("direct");
    // Legacy "view" normalizes to the "viewer" role.
    expect(body.shares[0].role).toBe("viewer");
    // The recipient gets their OWN wrapped share key (RSA-encrypted to them) so
    // the client can decrypt the file — same contract as /api/direct-shares/[id].
    expect(body.shares[0].wrappedShareKey).toBe("k");
  });

  it("blocks guests from the org-wide shared list", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("guest_1");
    await createOrg();
    await addMember("guest_1", "guest");

    const res = await sharesGET(new NextRequest("http://localhost/x?scope=shared"), p());
    expect(res.status).toBe(403);
  });

  it("normalizes the recipient role in shared-with-me", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("member_1");
    await createOrg();
    await addMember("member_1", "member");
    const obj = await makeObject();
    await DirectShare.create({
      objectId: obj._id,
      bucketId: obj.bucketId,
      createdBy: "owner_1",
      recipients: [
        { recipientUserId: "member_1", recipientEmail: "member_1@e.com", wrappedShareKey: "k", accessType: "editor", downloadCount: 0 },
      ],
      isRevoked: false,
    });

    const res = await sharesGET(new NextRequest("http://localhost/x?scope=with-me"), p());
    const body = await res.json();
    expect(body.shares[0].role).toBe("editor");
  });

  it("gates comment posting on the commenter role", async () => {
    const obj = await makeObject();
    const share = await DirectShare.create({
      objectId: obj._id,
      bucketId: obj.bucketId,
      createdBy: "owner_1",
      recipients: [
        { recipientUserId: "viewer_1", recipientEmail: "viewer_1@e.com", wrappedShareKey: "k", accessType: "viewer", downloadCount: 0 },
      ],
      isRevoked: false,
    });
    void share;
    // Comments are object-centric now — recipients reach them via the object id.
    const cp = { params: Promise.resolve({ id: String(obj._id) }) };
    const makeReq = () =>
      new NextRequest("http://localhost/c", {
        method: "POST",
        body: JSON.stringify({ ciphertext: "cipher" }),
        headers: { "content-type": "application/json" },
      });

    // Viewer cannot comment.
    mockSession("viewer_1");
    const denied = await commentsPOST(makeReq(), cp);
    expect(denied.status).toBe(403);

    // Promote to commenter → allowed.
    await DirectShare.updateOne(
      { _id: share._id },
      { $set: { "recipients.0.accessType": "commenter" } },
    );
    const ok = await commentsPOST(makeReq(), cp);
    expect(ok.status).toBe(200);
  });
});

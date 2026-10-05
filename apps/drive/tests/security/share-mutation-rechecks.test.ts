import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE as linkDELETE, PATCH as linkPATCH } from "@/app/api/share/[token]/route";
import { DELETE as directDELETE, PATCH as directPATCH } from "@/app/api/direct-shares/[id]/route";
import { PATCH as decidePATCH } from "@/app/api/direct-shares/access-requests/[reqId]/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import DirectShare from "@/models/DirectShare";
import OrganizationPolicy from "@/models/OrganizationPolicy";
import ShareAccessRequest from "@/models/ShareAccessRequest";
import ShareLink from "@/models/ShareLink";
import StorageObject from "@/models/StorageObject";
import { ensureOrganizationSpace } from "@xenode/spaces/repository";

const mockedSession = vi.mocked(getServerSession);
const orgId = "org_shares";
const spaceId = `space_org_${orgId}`;

function as(userId: string) {
  mockedSession.mockResolvedValue({
    user: { id: userId, email: `${userId}@example.com` },
    session: { id: `session-${userId}` },
  } as unknown as NonNullable<Awaited<ReturnType<typeof getServerSession>>>);
}

function request(method: string, body: object = {}) {
  return new NextRequest("http://localhost/api/share", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function setRole(userId: string, role: string) {
  await Bucket.db.collection("member").updateOne(
    { organizationId: orgId, userId },
    { $set: { role, createdAt: new Date() } },
    { upsert: true },
  );
}

async function fixture() {
  process.env.ORGS_ENABLED = "true";
  await Bucket.db.collection("organization").insertOne({ id: orgId, name: "Acme", slug: orgId, createdAt: new Date() });
  await ensureOrganizationSpace({ accountId: "admin_a", organizationId: orgId });
  for (const [userId, role] of [["admin_a", "admin"], ["admin_b", "admin"], ["member_c", "member"]]) {
    await setRole(userId, role);
  }
  const bucket = await Bucket.findOneAndUpdate(
    { systemKey: "drive" },
    { $setOnInsert: { systemKey: "drive", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" } },
    { upsert: true, new: true },
  );
  const object = await StorageObject.create({
    bucketId: bucket!._id, spaceId, createdByAccountId: "admin_a",
    key: `workspaces/${orgId}/objects/report`, size: 10, contentType: "application/octet-stream",
    b2FileId: "f", isEncrypted: true, wrappedBy: "space", encryptedDEK: "wrapped", spaceKeyVersion: 1,
  });
  const link = await ShareLink.create({
    objectId: object._id, bucketId: bucket!._id, createdBy: "admin_a",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  const direct = await DirectShare.create({
    objectId: object._id, bucketId: bucket!._id, createdBy: "admin_a", isRevoked: false,
    recipients: [{ recipientUserId: "guest_d", recipientEmail: "guest_d@example.com", wrappedShareKey: "k", accessType: "viewer", downloadCount: 0 }],
  });
  return { object, link, direct };
}

describe("share mutations recheck current share rights", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    mockedSession.mockReset();
  });

  it("stops a demoted creator from editing a link but still lets them revoke it", async () => {
    const { link } = await fixture();
    await setRole("admin_a", "member");
    as("admin_a");

    const edit = await linkPATCH(request("PATCH", { expiresAt: null }), { params: Promise.resolve({ token: link.token }) });
    expect(edit.status).toBe(403);
    expect((await ShareLink.findById(link._id).lean())?.expiresAt).toBeInstanceOf(Date);

    const revoke = await linkDELETE(request("DELETE"), { params: Promise.resolve({ token: link.token }) });
    expect(revoke.status).toBe(200);
    expect((await ShareLink.findById(link._id).lean())?.isRevoked).toBe(true);
  });

  it("applies organization link policy to edits", async () => {
    const { link } = await fixture();
    as("admin_a");
    const params = { params: Promise.resolve({ token: link.token }) };

    await OrganizationPolicy.create({ orgId, requireExpiry: true });
    const dropExpiry = await linkPATCH(request("PATCH", { expiresAt: null }), params);
    expect(dropExpiry.status).toBe(400);
    expect((await dropExpiry.json()).code).toBe("organization_share_expiry_required");

    await OrganizationPolicy.updateOne({ orgId }, { $set: { allowPublicLinks: false } });
    const anyEdit = await linkPATCH(request("PATCH", { maxDownloads: 5 }), params);
    expect(anyEdit.status).toBe(403);
    expect((await ShareLink.findById(link._id).lean())?.maxDownloads).toBeUndefined();
  });

  it("lets another admin revoke a member's links but not a plain member", async () => {
    const { link, direct } = await fixture();
    as("member_c");
    expect((await linkDELETE(request("DELETE"), { params: Promise.resolve({ token: link.token }) })).status).toBe(403);
    expect((await directDELETE(request("DELETE"), { params: Promise.resolve({ id: String(direct._id) }) })).status).toBe(403);
    expect((await ShareLink.findById(link._id).lean())?.isRevoked).toBe(false);

    as("admin_b");
    expect((await linkDELETE(request("DELETE"), { params: Promise.resolve({ token: link.token }) })).status).toBe(200);
    expect((await directDELETE(request("DELETE"), { params: Promise.resolve({ id: String(direct._id) }) })).status).toBe(200);
    expect((await DirectShare.findById(direct._id).lean())?.isRevoked).toBe(true);
  });

  it("stops a demoted creator from re-keying a direct share or approving upgrades", async () => {
    const { object, direct } = await fixture();
    const upgrade = await ShareAccessRequest.create({
      directShareId: direct._id, objectId: object._id, requesterUserId: "guest_d",
      ownerUserId: "admin_a", orgId, currentRole: "viewer", requestedRole: "editor",
    });
    await setRole("admin_a", "member");
    as("admin_a");

    const rekey = await directPATCH(
      request("PATCH", { recipients: [{ recipientUserId: "outsider", recipientEmail: "o@example.com", wrappedShareKey: "x", accessType: "editor" }] }),
      { params: Promise.resolve({ id: String(direct._id) }) },
    );
    expect(rekey.status).toBe(403);

    const approve = await decidePATCH(request("PATCH", { decision: "approve" }), { params: Promise.resolve({ reqId: String(upgrade._id) }) });
    expect(approve.status).toBe(403);
    const recipients = (await DirectShare.findById(direct._id).lean())?.recipients ?? [];
    expect(recipients.map((recipient) => [recipient.recipientUserId, recipient.accessType])).toEqual([["guest_d", "viewer"]]);
    expect((await ShareAccessRequest.findById(upgrade._id).lean())?.status).toBe("pending");
  });
});

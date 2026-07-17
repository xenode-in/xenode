import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { uploadObject, deleteObjects, adjustStorageBytes, updateBucketStats, adjustOrgStorage } = vi.hoisted(() => ({
  uploadObject: vi.fn(async (..._args: unknown[]) => ({ b2FileId: "b2-new" })),
  deleteObjects: vi.fn(async () => {}),
  adjustStorageBytes: vi.fn(async () => {}),
  updateBucketStats: vi.fn(async () => {}),
  adjustOrgStorage: vi.fn(async () => {}),
}));

vi.mock("@/lib/b2/objects", () => ({
  uploadObject,
  deleteObjects,
  getUploadUrl: vi.fn(async () => "https://upload.example.test/presigned"),
}));

vi.mock("@/lib/metering/usage", () => ({
  adjustStorageBytes,
  updateBucketStats,
}));

vi.mock("@/lib/orgs/billing/orgUsage", () => ({ adjustOrgStorage }));

import { POST } from "@/app/api/direct-shares/[id]/update-content/route";
import { getServerSession } from "@/lib/auth/session";
import { REVISION_HEADER } from "@/lib/storage/revisions";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import DirectShare from "@/models/DirectShare";
import { ensurePersonalSpace, ensureOrganizationSpace } from "@xenode/spaces/repository";
import mongoose from "mongoose";

const mockedGetServerSession = vi.mocked(getServerSession);

function mockSession(userId: string) {
  mockedGetServerSession.mockResolvedValue({
    user: { id: userId, email: `${userId}@e.com`, name: userId, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
    session: { id: `s-${userId}`, userId, token: `t-${userId}`, createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
  } as unknown as Awaited<ReturnType<typeof getServerSession>>);
}

async function makeObject(overrides: Record<string, unknown> = {}) {
  const bucket = await Bucket.findOneAndUpdate(
    { systemKey: "drive" },
    { $setOnInsert: { systemKey: "drive", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" } },
    { upsert: true, new: true },
  );
  const spaceId = (overrides.spaceId as string | undefined) ?? "space_personal_owner_1";
  if (spaceId.startsWith("space_org_")) {
    await ensureOrganizationSpace({ accountId: "owner_1", organizationId: "org_1" });
  } else {
    await ensurePersonalSpace("owner_1");
  }
  return StorageObject.create({
    bucketId: bucket!._id,
    spaceId,
    createdByAccountId: "owner_1",
    key: "users/owner_1/sheet.bin",
    size: 100,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    mediaCategory: "excel",
    b2FileId: "f-original",
    isEncrypted: true,
    encryptedDEK: "wrapped",
    iv: "orig-iv",
    ...overrides,
  });
}

async function makeShare(
  objId: mongoose.Types.ObjectId,
  bucketId: mongoose.Types.ObjectId,
  role: "viewer" | "commenter" | "editor" = "viewer",
) {
  return DirectShare.create({
    objectId: objId,
    bucketId,
    createdBy: "owner_1",
    shareEncryptedDEK: "dek",
    shareKeyIv: "iv",
    recipients: [
      { recipientUserId: "member_1", recipientEmail: "member_1@e.com", wrappedShareKey: "k", accessType: role, downloadCount: 0 },
    ],
    isRevoked: false,
  });
}

function saveRequest(options: { baseRevision?: string | null; iv?: string | null; body?: Uint8Array } = {}) {
  const { baseRevision = "0", iv = "new-iv", body = new Uint8Array([1, 2, 3, 4]) } = options;
  const url = iv === null
    ? "http://localhost/x"
    : `http://localhost/x?iv=${encodeURIComponent(iv)}`;
  const headers: Record<string, string> = { "content-type": "application/octet-stream" };
  if (baseRevision !== null) headers[REVISION_HEADER] = baseRevision;
  return new NextRequest(url, {
    method: "POST",
    body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    headers,
  });
}

function reqParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("direct-share update-content role enforcement", () => {
  afterEach(() => {
    mockedGetServerSession.mockReset();
    uploadObject.mockClear();
    deleteObjects.mockClear();
    adjustStorageBytes.mockClear();
    adjustOrgStorage.mockClear();
    updateBucketStats.mockClear();
  });

  it("rejects a viewer recipient with 403 edit_forbidden", async () => {
    const obj = await makeObject();
    const share = await makeShare(obj._id, obj.bucketId, "viewer");
    mockSession("member_1");

    const res = await POST(saveRequest(), reqParams(String(share._id)));
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe("edit_forbidden");
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it("rejects a commenter recipient", async () => {
    const obj = await makeObject();
    const share = await makeShare(obj._id, obj.bucketId, "commenter");
    mockSession("member_1");

    const res = await POST(saveRequest(), reqParams(String(share._id)));
    expect(res.status).toBe(403);
  });

  it("rejects a non-recipient", async () => {
    const obj = await makeObject();
    const share = await makeShare(obj._id, obj.bucketId, "editor");
    mockSession("intruder_1");

    const res = await POST(saveRequest(), reqParams(String(share._id)));
    expect(res.status).toBe(403);
  });

  it("returns 404 for a revoked share", async () => {
    const obj = await makeObject();
    const share = await makeShare(obj._id, obj.bucketId, "editor");
    await DirectShare.updateOne({ _id: share._id }, { isRevoked: true });
    mockSession("member_1");

    const res = await POST(saveRequest(), reqParams(String(share._id)));
    expect(res.status).toBe(404);
  });

  it("requires the base revision header", async () => {
    const obj = await makeObject();
    const share = await makeShare(obj._id, obj.bucketId, "editor");
    mockSession("member_1");

    const res = await POST(saveRequest({ baseRevision: null }), reqParams(String(share._id)));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.code).toBe("base_revision_required");
  });

  it("lets an editor recipient save: bumps revision, attributes the version, pins the excel original", async () => {
    const obj = await makeObject();
    const share = await makeShare(obj._id, obj.bucketId, "editor");
    mockSession("member_1");

    const res = await POST(saveRequest(), reqParams(String(share._id)));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.revision).toBe(1);
    expect(uploadObject).toHaveBeenCalledTimes(1);
    // The fresh B2 key must live under the OWNER's prefix, not the recipient's.
    expect(String(uploadObject.mock.calls[0][1])).toMatch(/^users\/owner_1\//);

    const updated = await StorageObject.findById(obj._id).lean();
    expect(updated!.revision).toBe(1);
    expect(updated!.iv).toBe("new-iv");
    expect(updated!.versions?.length).toBeGreaterThan(0);
    const original = updated!.versions!.find((v) => v.isOriginal);
    expect(original).toBeTruthy();
    expect(original!.createdBy).toBe("member_1");
    // Owner-attributed quota.
    expect(adjustStorageBytes).toHaveBeenCalledWith("owner_1", expect.any(Number));
    expect(adjustOrgStorage).not.toHaveBeenCalled();
  });

  it("rejects a stale base revision with 409 and the latest revision", async () => {
    const obj = await makeObject({ revision: 3 });
    const share = await makeShare(obj._id, obj.bucketId, "editor");
    mockSession("member_1");

    const res = await POST(saveRequest({ baseRevision: "1" }), reqParams(String(share._id)));
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.code).toBe("revision_conflict");
    expect(data.revision).toBe(3);
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it("attributes quota to the org for org-owned objects", async () => {
    const obj = await makeObject({
      spaceId: "space_org_org_1",
      key: "workspaces/org_1/objects/sheet.bin",
    });
    const share = await makeShare(obj._id, obj.bucketId, "editor");
    mockSession("member_1");

    const res = await POST(saveRequest(), reqParams(String(share._id)));

    expect(res.status).toBe(200);
    expect(adjustOrgStorage).toHaveBeenCalledWith("org_1", expect.any(Number));
    expect(adjustStorageBytes).not.toHaveBeenCalled();
    expect(String(uploadObject.mock.calls[0][1])).toMatch(/^workspaces\/org_1\/objects\//);
  });
});

import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Space } from "@xenode/database";

const { send, publish } = vi.hoisted(() => ({ send: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/b2/client", () => ({ getS3Client: () => ({ send }) }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async () => "https://r2.example.test/signed"),
}));
vi.mock("@/lib/realtime/publish", () => ({
  publishSyncEvent: publish,
  toSyncObjectSnapshot: (value: unknown) => JSON.parse(JSON.stringify(value)),
}));

import { DELETE as deleteFolder, POST as createFolder } from "@/app/api/objects/folder/route";
import { POST as moveObjects } from "@/app/api/objects/move/route";
import { POST as restoreObjects } from "@/app/api/objects/restore/route";
import { GET as listObjects } from "@/app/api/objects/route";
import { POST as completeUpload } from "@/app/api/objects/complete-upload/route";
import { POST as presign } from "@/app/api/objects/presign-upload/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import UploadSession from "@/models/UploadSession";
import Usage from "@/models/Usage";
import { createUsage, makeUserId } from "../helpers/factories";

const ENCRYPTED_NAME = "encrypted-folder-name-envelope";

function request(path: string, method: string, body?: object, spaceId?: string) {
  const url = `http://localhost${path}${spaceId ? `${path.includes("?") ? "&" : "?"}spaceId=${spaceId}` : ""}`;
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function personal() {
  const accountId = makeUserId();
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id: accountId },
    session: { id: `session-${accountId}` },
  } as unknown as NonNullable<Awaited<ReturnType<typeof getServerSession>>>);
  const spaceId = `space_personal_${accountId}`;
  await Space.create({ _id: spaceId, type: "personal", ownerAccountId: accountId, createdByAccountId: accountId });
  // One system bucket serves every Space; isolation is per-object spaceId.
  const bucket = (await Bucket.findOne({ systemKey: "drive" })) ?? await Bucket.create({
    systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage",
  });
  await createUsage({ userId: accountId, storageLimitBytes: 1_000_000 });
  return { accountId, spaceId, bucket, root: `users/${accountId}/` };
}

type Fixture = Awaited<ReturnType<typeof personal>>;

async function folder(fixture: Fixture, parentFolderId: string | null = null) {
  const response = await createFolder(request("/api/objects/folder", "POST", {
    bucketId: String(fixture.bucket._id), encryptedDisplayName: ENCRYPTED_NAME, parentFolderId,
  }));
  expect(response.status).toBe(201);
  return (await response.json()).folder as { _id: string; key: string; folderId: string | null; ancestorIds: string[] };
}

/** A committed file record placed under `folderId` (null = root). */
async function file(fixture: Fixture, folderId: string | null, extra: Record<string, unknown> = {}) {
  const parent = folderId ? await StorageObject.findById(folderId).lean() : null;
  const _id = new Types.ObjectId();
  const key = `${fixture.root}${_id.toHexString().padEnd(32, "0")}`;
  await StorageObject.collection.insertOne({
    _id, productId: "drive", spaceId: fixture.spaceId, createdByAccountId: fixture.accountId,
    bucketId: fixture.bucket._id, key, size: 10, contentType: "application/octet-stream",
    mediaCategory: "other", b2FileId: "", tags: [], position: 0, isEncrypted: true,
    encryptedDEK: "wrapped", encryptedName: "encrypted-file-name", revision: 0, isSidecar: false,
    folderId: parent ? parent._id : null,
    ancestorIds: parent ? [...(parent.ancestorIds ?? []), parent._id] : [],
    createdAt: new Date(), updatedAt: new Date(), __v: 0, ...extra,
  });
  return { _id: String(_id), key };
}

const ids = (values: Array<{ toString(): string }> | undefined) => (values ?? []).map(String);

beforeEach(() => {
  send.mockReset();
  publish.mockReset().mockResolvedValue(undefined);
});

describe("Drive folders are metadata", () => {
  it("creates blob-less, name-free folder records and requires an encrypted name", async () => {
    const fixture = await personal();
    const parent = await folder(fixture);
    const child = await folder(fixture, parent._id);

    expect(parent.key).toBe(`${fixture.root}${parent._id}/`);
    // Zero-byte records, counted so purge can retire them symmetrically.
    expect((await Usage.findOne({ userId: fixture.accountId }))?.toObject()).toMatchObject({ totalObjects: 2, totalStorageBytes: 0 });
    expect(child.folderId).toBe(parent._id);
    expect(child.ancestorIds).toEqual([parent._id]);
    expect(send).not.toHaveBeenCalled();

    const plaintext = await createFolder(request("/api/objects/folder", "POST", {
      bucketId: String(fixture.bucket._id), name: "Tax returns",
    }));
    expect(plaintext.status).toBe(400);
  });

  it("refuses parents outside the Space or in the Bin", async () => {
    const other = await personal();
    const foreign = await folder(other);
    const fixture = await personal();
    const response = await createFolder(request("/api/objects/folder", "POST", {
      bucketId: String(fixture.bucket._id), encryptedDisplayName: ENCRYPTED_NAME, parentFolderId: foreign._id,
    }));
    expect(response.status).toBe(404);

    const binned = await folder(fixture);
    expect((await deleteFolder(request("/api/objects/folder", "DELETE", { folderId: binned._id }))).status).toBe(200);
    const underBinned = await createFolder(request("/api/objects/folder", "POST", {
      bucketId: String(fixture.bucket._id), encryptedDisplayName: ENCRYPTED_NAME, parentFolderId: binned._id,
    }));
    expect(underBinned.status).toBe(404);
  });

  it("caps the ancestor chain at 32 folders", async () => {
    const fixture = await personal();
    let parent: string | null = null;
    for (let depth = 0; depth <= 32; depth += 1) parent = (await folder(fixture, parent))._id;
    expect((await StorageObject.findById(parent).lean())?.ancestorIds).toHaveLength(32);
    const tooDeep = await createFolder(request("/api/objects/folder", "POST", {
      bucketId: String(fixture.bucket._id), encryptedDisplayName: ENCRYPTED_NAME, parentFolderId: parent,
    }));
    expect(tooDeep.status).toBe(400);
  });

  it("issues Space-root keys regardless of any client prefix", async () => {
    const fixture = await personal();
    const response = await presign(request("/api/objects/presign-upload", "POST", {
      bucketId: String(fixture.bucket._id), fileSize: 10, fileType: "application/octet-stream",
      prefix: `${fixture.root}Taxes/2026/`,
    }));
    expect(response.status).toBe(200);
    const { objectKey } = await response.json();
    expect(objectKey).toMatch(new RegExp(`^${fixture.root}[0-9a-f]{32}$`));
  });

  it("places completed uploads in a live folder of the same Space only", async () => {
    const fixture = await personal();
    const target = await folder(fixture);
    const other = await personal();
    const foreign = await folder(other);
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: fixture.accountId }, session: { id: "s" },
    } as unknown as NonNullable<Awaited<ReturnType<typeof getServerSession>>>);

    async function reserve() {
      const key = `${fixture.root}${new Types.ObjectId().toHexString().padEnd(32, "0")}`;
      const upload = await UploadSession.create({
        userId: fixture.accountId, spaceId: fixture.spaceId, bucketId: fixture.bucket._id,
        fileId: key, keys: [key], expiresAt: new Date(Date.now() + 60_000),
      });
      send.mockResolvedValue({ ContentLength: 10, VersionId: "v" });
      return { key, upload };
    }
    const body = (key: string, sessionId: string, folderId: string | null) => ({
      objectKey: key, bucketId: String(fixture.bucket._id), sessionId, size: 10,
      contentType: "application/octet-stream", isEncrypted: true, encryptedDEK: "wrapped",
      encryptedName: "encrypted-name", iv: "iv", folderId,
    });

    const rejected = await reserve();
    const denied = await completeUpload(request("/api/objects/complete-upload", "POST",
      body(rejected.key, String(rejected.upload._id), foreign._id)));
    expect(denied.status).toBe(404);
    expect((await UploadSession.findById(rejected.upload._id).lean())?.status).toBe("pending");
    expect(await StorageObject.exists({ key: rejected.key })).toBeNull();

    const placed = await reserve();
    const created = await completeUpload(request("/api/objects/complete-upload", "POST",
      body(placed.key, String(placed.upload._id), target._id)));
    expect(created.status).toBe(201);
    const stored = await StorageObject.findOne({ key: placed.key }).lean();
    expect(String(stored?.folderId)).toBe(target._id);
    expect(ids(stored?.ancestorIds)).toEqual([target._id]);
  });
});

describe("Drive moves never touch blobs", () => {
  it("rewrites folder placement and descendant chains while keys and versions stay put", async () => {
    const fixture = await personal();
    const projects = await folder(fixture);
    const archive = await folder(fixture);
    const nested = await folder(fixture, projects._id);
    const deep = await file(fixture, nested._id, {
      versions: [{ versionId: "original", isOriginal: true, sharesCurrentContent: true,
        key: "pinned-original-key", b2FileId: "", size: 10, createdAt: new Date(), createdBy: "x" }],
    });

    const response = await moveObjects(request("/api/objects/move", "POST", {
      objectIds: [projects._id], destinationFolderId: archive._id,
    }));
    expect(response.status).toBe(200);
    expect(send).not.toHaveBeenCalled();

    const movedFolder = await StorageObject.findById(projects._id).lean();
    const movedFile = await StorageObject.findById(deep._id).lean();
    expect(String(movedFolder?.folderId)).toBe(archive._id);
    expect(ids(movedFolder?.ancestorIds)).toEqual([archive._id]);
    expect(ids(movedFile?.ancestorIds)).toEqual([archive._id, projects._id, nested._id]);
    expect(movedFile?.key).toBe(deep.key);
    expect(movedFile?.versions?.[0]?.key).toBe("pinned-original-key");

    const back = await moveObjects(request("/api/objects/move", "POST", {
      objectIds: [deep._id], destinationFolderId: null,
    }));
    expect(back.status).toBe(200);
    const atRoot = await StorageObject.findById(deep._id).lean();
    expect(atRoot?.folderId).toBeNull();
    expect(atRoot?.ancestorIds).toEqual([]);
  });

  it("refuses cycles, foreign destinations and moves only the outermost selection", async () => {
    const fixture = await personal();
    const outer = await folder(fixture);
    const inner = await folder(fixture, outer._id);
    const cycle = await moveObjects(request("/api/objects/move", "POST", {
      objectIds: [outer._id], destinationFolderId: inner._id,
    }));
    expect(cycle.status).toBe(400);

    const other = await personal();
    const foreign = await folder(other);
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: fixture.accountId }, session: { id: "s" },
    } as unknown as NonNullable<Awaited<ReturnType<typeof getServerSession>>>);
    const crossSpace = await moveObjects(request("/api/objects/move", "POST", {
      objectIds: [outer._id], destinationFolderId: foreign._id,
    }));
    expect(crossSpace.status).toBe(404);

    const target = await folder(fixture);
    const both = await moveObjects(request("/api/objects/move", "POST", {
      objectIds: [outer._id, inner._id], destinationFolderId: target._id,
    }));
    expect(both.status).toBe(200);
    expect(String((await StorageObject.findById(inner._id).lean())?.folderId)).toBe(outer._id);
    expect(ids((await StorageObject.findById(inner._id).lean())?.ancestorIds)).toEqual([target._id, outer._id]);
  });
});

describe("Drive Bin keeps folder batches together", () => {
  it("bins a subtree in one batch and restores exactly that batch", async () => {
    const fixture = await personal();
    const albums = await folder(fixture);
    const kept = await file(fixture, albums._id);
    const earlier = await file(fixture, albums._id, { deletedAt: new Date(Date.now() - 60_000) });
    const sidecar = await file(fixture, albums._id, { isSidecar: true, parentObjectId: new Types.ObjectId(kept._id) });

    const binFolder = await deleteFolder(request("/api/objects/folder", "DELETE", { folderId: albums._id }));
    expect(binFolder.status).toBe(200);
    const batch = await StorageObject.find({ _id: { $in: [albums._id, kept._id, sidecar._id] } }).lean();
    expect(batch.every((object) => object.deletedAt instanceof Date)).toBe(true);
    expect(new Set(batch.map((object) => object.deletedAt?.toISOString())).size).toBe(1);
    const binnedEarlier = (await StorageObject.findById(earlier._id).lean())?.deletedAt;
    expect(binnedEarlier?.getTime()).toBeLessThan(batch[0].deletedAt!.getTime());

    const restored = await restoreObjects(request("/api/objects/restore", "POST", {
      bucketId: String(fixture.bucket._id), ids: [albums._id],
    }));
    expect(restored.status).toBe(200);
    expect(await StorageObject.countDocuments({ _id: { $in: [albums._id, kept._id, sidecar._id] }, deletedAt: null })).toBe(3);
    expect((await StorageObject.findById(earlier._id).lean())?.deletedAt).toEqual(binnedEarlier);
  });

  it("restores a folder batch larger than one Bin page", async () => {
    const fixture = await personal();
    const big = await folder(fixture);
    const nested = await folder(fixture, big._id);
    for (let index = 0; index < 120; index += 1) await file(fixture, index % 2 ? nested._id : big._id);
    expect((await deleteFolder(request("/api/objects/folder", "DELETE", { folderId: big._id }))).status).toBe(200);

    const restored = await restoreObjects(request("/api/objects/restore", "POST", {
      bucketId: String(fixture.bucket._id), ids: [big._id],
    }));
    expect(restored.status).toBe(200);
    expect(await StorageObject.countDocuments({ spaceId: fixture.spaceId, deletedAt: { $exists: true } })).toBe(0);
    expect(await StorageObject.countDocuments({ spaceId: fixture.spaceId })).toBe(122);
  });

  it("re-homes a restored item whose folder is still in the Bin", async () => {
    const fixture = await personal();
    const top = await folder(fixture);
    const middle = await folder(fixture, top._id);
    const leaf = await file(fixture, middle._id);
    await StorageObject.updateOne({ _id: leaf._id }, { $set: { deletedAt: new Date(Date.now() - 1000) } });
    await deleteFolder(request("/api/objects/folder", "DELETE", { folderId: middle._id }));

    const restored = await restoreObjects(request("/api/objects/restore", "POST", {
      bucketId: String(fixture.bucket._id), ids: [leaf._id],
    }));
    expect(restored.status).toBe(200);
    const rehomed = await StorageObject.findById(leaf._id).lean();
    expect(rehomed?.deletedAt).toBeUndefined();
    expect(String(rehomed?.folderId)).toBe(top._id);
    expect(ids(rehomed?.ancestorIds)).toEqual([top._id]);
  });

  it("lists only the direct children of the requested folder", async () => {
    const fixture = await personal();
    const parent = await folder(fixture);
    const child = await file(fixture, parent._id);
    const grandchildFolder = await folder(fixture, parent._id);
    await file(fixture, grandchildFolder._id);
    const rootFile = await file(fixture, null);

    const inParent = await listObjects(request(
      `/api/objects?bucketId=${fixture.bucket._id}&folder=${parent._id}&fetchAll=true`, "GET"));
    expect(inParent.status).toBe(200);
    const parentIds = ((await inParent.json()).objects as Array<{ _id: string }>).map((object) => object._id).sort();
    expect(parentIds).toEqual([child._id, grandchildFolder._id].sort());

    const atRoot = await listObjects(request(
      `/api/objects?bucketId=${fixture.bucket._id}&folder=root&fetchAll=true`, "GET"));
    const rootIds = ((await atRoot.json()).objects as Array<{ _id: string }>).map((object) => object._id).sort();
    expect(rootIds).toEqual([parent._id, rootFile._id].sort());
  });
});

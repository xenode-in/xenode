import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceAccess } from "@xenode/spaces";

const { session, resolveAccess, findObject, createAsset, createAlbum, findAssets } = vi.hoisted(() => ({
  session: vi.fn(), resolveAccess: vi.fn(), findObject: vi.fn(),
  createAsset: vi.fn(), createAlbum: vi.fn(), findAssets: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getPhotosProductSession: session }));
vi.mock("@xenode/spaces", async (importOriginal) => ({
  ...await importOriginal<typeof import("@xenode/spaces")>(), resolveSpaceAccess: resolveAccess,
}));
vi.mock("@xenode/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@xenode/database")>(),
  getDatabase: () => ({ collection: () => ({ findOne: findObject }) }),
}));
vi.mock("@/lib/photos-repository", () => ({
  MongoPhotosRepository: class {
    createAsset = createAsset;
    createAlbum = createAlbum;
    findAssets = findAssets;
    findByStorageObject = vi.fn(async () => null);
  },
}));

import { POST as asset } from "../app/api/photos/assets/route";
import { POST as album } from "../app/api/photos/albums/route";

const spaceId = "space_org_test";
function request(path: string, body: object) {
  return new Request(`http://localhost/api/photos/${path}?spaceId=${spaceId}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
const assetBody = { spaceId, storageObjectId: "000000000000000000000001", mediaType: "image", takenAt: "2026-09-17T00:00:00Z" };
const albumBody = { encryptedName: "synthetic-envelope-placeholder", photoAssetIds: ["asset-1"] };

describe("Photos mutation permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.mockResolvedValue({ accountId: "member" });
    resolveAccess.mockResolvedValue({ role: "guest" } as SpaceAccess);
    findObject.mockResolvedValue({ _id: assetBody.storageObjectId });
    findAssets.mockResolvedValue([{ id: "asset-1" }]);
    createAsset.mockImplementation(async (value) => value);
    createAlbum.mockImplementation(async (value) => value);
  });

  it("rejects a guest projection before accessing storage metadata", async () => {
    expect((await asset(request("assets", assetBody))).status).toBe(403);
    expect(findObject).not.toHaveBeenCalled();
    expect(createAsset).not.toHaveBeenCalled();
  });

  it("rejects guest album creation before reading or writing album assets", async () => {
    expect((await album(request("albums", albumBody))).status).toBe(403);
    expect(findAssets).not.toHaveBeenCalled();
    expect(createAlbum).not.toHaveBeenCalled();
  });

  it("allows authorized members to create projections and albums", async () => {
    resolveAccess.mockResolvedValue({ role: "member" } as SpaceAccess);
    expect((await asset(request("assets", assetBody))).status).toBe(201);
    expect((await album(request("albums", albumBody))).status).toBe(201);
    expect(createAsset).toHaveBeenCalledOnce();
    expect(createAlbum).toHaveBeenCalledOnce();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceAccess } from "@xenode/spaces";

const { session, resolveAccess, createAlbum, findAssets } = vi.hoisted(() => ({
  session: vi.fn(), resolveAccess: vi.fn(), createAlbum: vi.fn(), findAssets: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getPhotosProductSession: session }));
vi.mock("@xenode/spaces", async (importOriginal) => ({
  ...await importOriginal<typeof import("@xenode/spaces")>(), resolveSpaceAccess: resolveAccess,
}));
vi.mock("@/lib/photos-repository", () => ({
  MongoPhotosRepository: class {
    createAlbum = createAlbum;
    findAssets = findAssets;
  },
}));

import { POST as album } from "../app/api/photos/albums/route";

const spaceId = "space_org_test";
function request(path: string, body: object) {
  return new Request(`http://localhost/api/photos/${path}?spaceId=${spaceId}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
const albumBody = { encryptedName: "synthetic-envelope-placeholder", photoAssetIds: ["asset-1"] };

describe("Photos mutation permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.mockResolvedValue({ accountId: "member" });
    resolveAccess.mockResolvedValue({ role: "guest" } as SpaceAccess);
    findAssets.mockResolvedValue([{ id: "asset-1" }]);
    createAlbum.mockImplementation(async (value) => value);
  });

  it("rejects guest album creation before reading or writing album assets", async () => {
    expect((await album(request("albums", albumBody))).status).toBe(403);
    expect(findAssets).not.toHaveBeenCalled();
    expect(createAlbum).not.toHaveBeenCalled();
  });

  it("allows authorized members to create albums", async () => {
    resolveAccess.mockResolvedValue({ role: "member" } as SpaceAccess);
    expect((await album(request("albums", albumBody))).status).toBe(201);
    expect(createAlbum).toHaveBeenCalledOnce();
  });
});

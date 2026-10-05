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
import { deriveMetadataKey } from "@xenode/crypto-core";
import { openAlbumName, sealAlbumName } from "../lib/album-name";

const spaceId = "space_org_test";
function request(path: string, body: object) {
  return new Request(`http://localhost/api/photos/${path}?spaceId=${spaceId}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
const albumBody = { encryptedName: "Summer holiday in Lisbon 2026", photoAssetIds: ["asset-1"] };
const metadataKey = () => deriveMetadataKey(crypto.getRandomValues(new Uint8Array(32)), "photos", spaceId);

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

  it("stores only a sealed album name bound to the Space and creator", async () => {
    resolveAccess.mockResolvedValue({ role: "member" } as SpaceAccess);
    // A typed title is never accepted as an "encrypted" name.
    expect((await album(request("albums", albumBody))).status).toBe(400);
    expect(createAlbum).not.toHaveBeenCalled();

    const key = await metadataKey();
    const encryptedName = await sealAlbumName(albumBody.encryptedName, key, "member", spaceId);
    expect(encryptedName).not.toContain("Lisbon");
    expect((await album(request("albums", { ...albumBody, encryptedName }))).status).toBe(201);
    expect(createAlbum).toHaveBeenCalledOnce();
    const stored = createAlbum.mock.calls[0][0].encryptedName as string;
    expect(stored).not.toContain("Lisbon");
    expect(await openAlbumName(stored, key, spaceId)).toBe("Summer holiday in Lisbon 2026");
    expect(await openAlbumName(stored, key, "space_org_other")).toBeNull();
    expect(await openAlbumName(stored, await metadataKey(), spaceId)).toBeNull();

    // An envelope sealed by another account is refused for this creator.
    const foreign = await sealAlbumName("Other", key, "someone-else", spaceId);
    expect((await album(request("albums", { ...albumBody, encryptedName: foreign }))).status).toBe(400);
  });
});

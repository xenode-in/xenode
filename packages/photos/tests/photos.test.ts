import { describe, expect, it } from "vitest";
import {
  PhotosService,
  PhotosUploadPolicy,
  photoQueryKey,
  type PhotoAlbum,
  type PhotoAsset,
  type PhotoRepository,
  type TimelineCursor,
} from "../src";

class MemoryPhotos implements PhotoRepository {
  assets: PhotoAsset[] = [];
  albums: PhotoAlbum[] = [];
  async createAsset(asset: PhotoAsset) {
    this.assets.push(asset);
    return asset;
  }
  async findByStorageObject(id: string) {
    return this.assets.find((asset) => asset.storageObjectId === id) ?? null;
  }
  async findBySyncFingerprint(spaceId: string, fingerprint: string) {
    return this.assets.find(
      (asset) =>
        asset.spaceId === spaceId &&
        asset.syncContentFingerprint === fingerprint,
    ) ?? null;
  }
  async listTimeline(
    spaceId: string,
    cursor: TimelineCursor | null,
    limit: number,
  ) {
    const sorted = this.assets
      .filter((asset) => asset.spaceId === spaceId)
      .sort(
        (a, b) =>
          b.takenAt.getTime() - a.takenAt.getTime() ||
          b.id.localeCompare(a.id),
      );
    const filtered = cursor
      ? sorted.filter(
          (asset) =>
            asset.takenAt < new Date(cursor.takenAt) ||
            (asset.takenAt.getTime() === new Date(cursor.takenAt).getTime() &&
              asset.id < cursor.id),
        )
      : sorted;
    return filtered.slice(0, limit);
  }
  async findAssets(spaceId: string, ids: string[]) {
    return this.assets.filter(
      (asset) => asset.spaceId === spaceId && ids.includes(asset.id),
    );
  }
  async createAlbum(album: PhotoAlbum) {
    this.albums.push(album);
    return album;
  }
}

const asset = (id: string, spaceId = "space_1"): PhotoAsset => ({
  id,
  spaceId,
  storageObjectId: `object_${id}`,
  mediaType: "image",
  takenAt: new Date(`2026-01-0${id}T00:00:00Z`),
  createdByAccountId: "acct_1",
});

describe("Photos domain", () => {
  it("projects one asset over one physical storage object idempotently", async () => {
    const repository = new MemoryPhotos();
    const service = new PhotosService(repository);
    expect(await service.createProjection(asset("1"))).toEqual(asset("1"));
    expect(await service.createProjection(asset("1"))).toEqual(asset("1"));
    expect(repository.assets).toHaveLength(1);
  });

  it("rejects cross-Space album assets", async () => {
    const repository = new MemoryPhotos();
    repository.assets.push(asset("1", "space_2"));
    const service = new PhotosService(repository);
    await expect(
      service.createAlbum({
        id: "album_1",
        spaceId: "space_1",
        encryptedName: "ciphertext",
        photoAssetIds: ["1"],
        createdByAccountId: "acct_1",
      }),
    ).rejects.toThrow("cross-Space");
  });

  it("uses stable cursors and product+Space cache partitioning", async () => {
    const repository = new MemoryPhotos();
    repository.assets.push(asset("1"), asset("2"), asset("3"));
    const service = new PhotosService(repository);
    const first = await service.timeline("space_1", null, 2);
    const second = await service.timeline("space_1", first.nextCursor, 2);
    expect(first.items.map((item) => item.id)).toEqual(["3", "2"]);
    expect(second.items.map((item) => item.id)).toEqual(["1"]);
    expect(photoQueryKey("photos", "space_1", "timeline")).toEqual([
      "photos",
      "space_1",
      "timeline",
    ]);
  });
  it("prepares only image/video uploads through the media pipeline", async () => {
    const policy = new PhotosUploadPolicy({
      async extract() {
        return { width: 1920, height: 1080 };
      },
      async createEncryptedPreview(_source, mediaType) {
        return `encrypted-preview:${mediaType}`;
      },
      async optimizeVideoForFastStart(source) {
        return source;
      },
    });
    const input = {
      id: "upload_1",
      name: "clip.mp4",
      size: 3,
      contentType: "video/mp4",
      source: new Blob(["abc"], { type: "video/mp4" }),
    };
    await policy.validate(input);
    expect(policy.takePreparation(input.id)).toMatchObject({
      mediaType: "video",
      metadata: { width: 1920, height: 1080 },
      encryptedPreview: "encrypted-preview:video",
    });
    await expect(
      policy.validate({
        ...input,
        id: "upload_2",
        name: "document.pdf",
        contentType: "application/pdf",
      }),
    ).rejects.toThrow("only image and video");
  });

  it("deduplicates mobile sync projections by Space fingerprint", async () => {
    const repository = new MemoryPhotos();
    const service = new PhotosService(repository);
    const first = {
      ...asset("1"),
      syncContentFingerprint: "device-hash-1",
    };
    const second = {
      ...asset("2"),
      syncContentFingerprint: "device-hash-1",
    };
    expect(await service.createProjection(first)).toEqual(first);
    expect(await service.createProjection(second)).toEqual(first);
    expect(repository.assets).toHaveLength(1);
  });
});

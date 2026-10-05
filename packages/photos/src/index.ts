export * from "./upload-policy";

export interface PhotoAsset {
  id: string;
  spaceId: string;
  storageObjectId: string;
  mediaType: "image" | "video";
  takenAt: Date;
  width?: number;
  height?: number;
  durationMs?: number;
  encryptedMetadata?: string;
  uploadSource?: string;
  status?: "active" | "trashed";
  createdByAccountId: string;
  syncContentFingerprint?: string;
}

export interface PhotoAlbum {
  id: string;
  spaceId: string;
  encryptedName: string;
  photoAssetIds: string[];
  coverPhotoAssetId?: string;
  sourceRef?: string;
  createdByAccountId: string;
}

export interface TimelineCursor {
  takenAt: string;
  id: string;
}

/**
 * Assets are created only by Photos upload completion, together with their
 * Photos-owned storage object; nothing projects another product's object.
 */
export interface PhotoRepository {
  listTimeline(
    spaceId: string,
    cursor: TimelineCursor | null,
    limit: number,
  ): Promise<PhotoAsset[]>;
  findAssets(spaceId: string, ids: string[]): Promise<PhotoAsset[]>;
  createAlbum(album: PhotoAlbum): Promise<PhotoAlbum>;
}

export function encodeTimelineCursor(cursor: TimelineCursor): string {
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function decodeTimelineCursor(value: string): TimelineCursor {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const parsed = JSON.parse(
      atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)),
    ) as Partial<TimelineCursor>;
    if (
      typeof parsed.takenAt !== "string" ||
      Number.isNaN(new Date(parsed.takenAt).getTime()) ||
      typeof parsed.id !== "string" ||
      !parsed.id
    ) {
      throw new Error();
    }
    return { takenAt: parsed.takenAt, id: parsed.id };
  } catch {
    throw new Error("Invalid timeline cursor");
  }
}

export class PhotosService {
  constructor(private readonly repository: PhotoRepository) {}

  async timeline(spaceId: string, cursorText: string | null, limit = 100) {
    const boundedLimit = Math.min(Math.max(limit, 1), 200);
    const cursor = cursorText ? decodeTimelineCursor(cursorText) : null;
    const assets = await this.repository.listTimeline(
      spaceId,
      cursor,
      boundedLimit + 1,
    );
    const hasMore = assets.length > boundedLimit;
    const items = assets.slice(0, boundedLimit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeTimelineCursor({
              takenAt: last.takenAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  async createAlbum(album: PhotoAlbum): Promise<PhotoAlbum> {
    const assets = await this.repository.findAssets(
      album.spaceId,
      album.photoAssetIds,
    );
    if (assets.length !== new Set(album.photoAssetIds).size) {
      throw new Error("Album contains inaccessible or cross-Space assets");
    }
    if (
      album.coverPhotoAssetId &&
      !album.photoAssetIds.includes(album.coverPhotoAssetId)
    ) {
      throw new Error("Album cover must be an album asset");
    }
    return this.repository.createAlbum({
      ...album,
      photoAssetIds: [...new Set(album.photoAssetIds)],
    });
  }
}

export function photoQueryKey(
  productId: "photos",
  spaceId: string,
  resource: string,
  ...parts: unknown[]
): readonly unknown[] {
  return [productId, spaceId, resource, ...parts] as const;
}

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

/**
 * An album name is a crypto-core envelope sealed by the creating account
 * under this Space's Photos metadata key; anything else (a typed title,
 * another Space's or purpose's envelope) is refused. The server can check
 * the shape and bindings, never the plaintext.
 */
export function isSealedAlbumName(
  value: unknown,
  spaceId: string,
  accountId: string,
): value is string {
  return isSealedPhotosEnvelope(value, spaceId, accountId, "album-name");
}

/** A photo's original name, sealed like an album name (see apps/photos/lib/album-name). */
export function isSealedPhotoMetadata(
  value: unknown,
  spaceId: string,
  accountId: string,
): value is string {
  return isSealedPhotosEnvelope(value, spaceId, accountId, "photo-metadata");
}

function isSealedPhotosEnvelope(
  value: unknown,
  spaceId: string,
  accountId: string,
  type: "album-name" | "photo-metadata",
): value is string {
  if (typeof value !== "string" || value.length > 4096) return false;
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(value) as Record<string, unknown>;
  } catch {
    return false;
  }
  return (
    typeof envelope === "object" &&
    envelope !== null &&
    envelope.formatVersion === 2 &&
    envelope.algorithm === "AES-256-GCM" &&
    envelope.aadVersion === 1 &&
    envelope.status === "active" &&
    envelope.type === type &&
    envelope.productId === "photos" &&
    envelope.keyId === "photos-metadata" &&
    envelope.keyVersion === 1 &&
    envelope.spaceId === spaceId &&
    envelope.accountId === accountId &&
    typeof envelope.iv === "string" &&
    /^[A-Za-z0-9_-]{16}$/u.test(envelope.iv) &&
    typeof envelope.ciphertext === "string" &&
    /^[A-Za-z0-9_-]{22,}$/u.test(envelope.ciphertext)
  );
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

import {
  PhotoAlbumV2,
  PhotoAsset as PhotoAssetModel,
  type PhotoAlbumRecord,
  type PhotoAssetRecord,
} from "@xenode/database";
import type {
  PhotoAlbum,
  PhotoAsset,
  PhotoRepository,
  TimelineCursor,
} from "@xenode/photos";

function toAsset(record: PhotoAssetRecord): PhotoAsset {
  return {
    id: record.assetId,
    spaceId: record.spaceId,
    storageObjectId: record.storageObjectId,
    mediaType: record.mediaType,
    takenAt: new Date(record.takenAt),
    width: record.width,
    height: record.height,
    durationMs: record.durationMs,
    encryptedMetadata: record.encryptedMetadata,
    uploadSource: record.uploadSource,
    status: record.status,
    createdByAccountId: record.createdByAccountId,
    syncContentFingerprint: record.syncContentFingerprint,
  };
}

function toAlbum(record: PhotoAlbumRecord): PhotoAlbum {
  return {
    id: record.albumId,
    spaceId: record.spaceId,
    encryptedName: record.encryptedName,
    photoAssetIds: [...record.photoAssetIds],
    coverPhotoAssetId: record.coverPhotoAssetId,
    sourceRef: record.sourceRef,
    createdByAccountId: record.createdByAccountId,
  };
}

export class MongoPhotosRepository implements PhotoRepository {
  async createAsset(asset: PhotoAsset): Promise<PhotoAsset> {
    const created = await PhotoAssetModel.create({
      assetId: asset.id,
      spaceId: asset.spaceId,
      storageObjectId: asset.storageObjectId,
      mediaType: asset.mediaType,
      takenAt: asset.takenAt,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      encryptedMetadata: asset.encryptedMetadata,
      uploadSource: asset.uploadSource ?? "web",
      status: asset.status ?? "active",
      createdByAccountId: asset.createdByAccountId,
      syncContentFingerprint: asset.syncContentFingerprint,
    });
    return toAsset(created.toObject() as PhotoAssetRecord);
  }

  async findByStorageObject(storageObjectId: string) {
    const record = await PhotoAssetModel.findOne({ storageObjectId }).lean();
    return record ? toAsset(record as PhotoAssetRecord) : null;
  }

  async findBySyncFingerprint(spaceId: string, fingerprint: string) {
    const record = await PhotoAssetModel.findOne({
      spaceId,
      syncContentFingerprint: fingerprint,
    }).lean();
    return record ? toAsset(record as PhotoAssetRecord) : null;
  }

  async listTimeline(
    spaceId: string,
    cursor: TimelineCursor | null,
    limit: number,
  ) {
    const query: Record<string, unknown> = { spaceId, status: "active" };
    if (cursor) {
      const takenAt = new Date(cursor.takenAt);
      query.$or = [
        { takenAt: { $lt: takenAt } },
        { takenAt, assetId: { $lt: cursor.id } },
      ];
    }
    const records = await PhotoAssetModel.find(query)
      .sort({ takenAt: -1, assetId: -1 })
      .limit(limit)
      .lean();
    return records.map((record) => toAsset(record as PhotoAssetRecord));
  }

  async findAssets(spaceId: string, ids: string[]) {
    const records = await PhotoAssetModel.find({
      spaceId,
      assetId: { $in: [...new Set(ids)] },
      status: "active",
    }).lean();
    return records.map((record) => toAsset(record as PhotoAssetRecord));
  }

  async createAlbum(album: PhotoAlbum): Promise<PhotoAlbum> {
    const created = await PhotoAlbumV2.create({
      albumId: album.id,
      spaceId: album.spaceId,
      encryptedName: album.encryptedName,
      photoAssetIds: album.photoAssetIds,
      coverPhotoAssetId: album.coverPhotoAssetId,
      sourceRef: album.sourceRef,
      createdByAccountId: album.createdByAccountId,
    });
    return toAlbum(created.toObject() as PhotoAlbumRecord);
  }
}

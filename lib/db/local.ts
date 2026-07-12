import Dexie, { Table } from "dexie";
import MiniSearch from "minisearch";

export interface MetadataCache {
  id: string; // The raw base64 encrypted string acts as the ID
  plaintext: string; // The decrypted name or tag
}

export interface ThumbnailCache {
  id: string; // The thumbnail key
  blob: Blob; // The decrypted thumbnail blob
  lastAccessed: number; // For LRU eviction
}

/**
 * A durable snapshot of an in-flight upload, so it can resume after a page
 * reload. We persist the ENCRYPTED bytes (never plaintext) plus every field
 * `complete-upload` needs, so resume re-PUTs byte-identical data with no
 * re-encryption — matching any chunks already in B2. `bytes`/`optimizedBytes`
 * are only stored when the total is within the resume cap (see UploadContext);
 * otherwise `bytesPersisted` is false and the row exists only to surface the
 * interrupted upload and drive server-side orphan cleanup.
 */
export interface UploadRecord {
  id: string; // matches UploadTask.id
  userId: string;
  status: "uploading" | "paused" | "failed";
  createdAt: number;

  // identity / display
  fileName: string; // real filename (also used to reconstruct the presign fileName on resume)
  size: number; // plaintext size
  type: string; // mime
  mediaCategory: string;
  bucketId: string;
  prefix: string;
  aspectRatio?: number;

  // routing / crypto
  isChunked: boolean;
  isEncrypted: boolean;

  // main object
  fileId: string; // logical/main B2 key (== objectKey), stable across resume
  sessionId?: string;
  uploadContentType: string; // Content-Type used for the PUT
  encryptedDEK?: string;
  iv?: string; // single-PUT only

  // chunk fields (chunked path)
  chunkSize?: number;
  cipherChunkSize?: number;
  chunkCount?: number;
  chunkIvs?: string; // JSON string of base64 IVs
  chunks?: { index: number; key: string; size: number }[];
  completedChunks: number[];

  // encrypted metadata for complete-upload
  encryptedName?: string;
  encryptedContentType?: string;
  encryptedMetadata?: string;

  // thumbnail (already-encrypted `enc:` string or plaintext data URL) → `${fileId}-thumb`
  thumbnail?: string;
  thumbnailKey?: string;

  // optimized preview (single-PUT image path only)
  optimizedKey?: string;
  optimizedIV?: string;
  optimizedEncryptedDEK?: string;
  optimizedSize?: number;
  optimizedContentType?: string;

  // persisted ciphertext (only when within the resume byte cap)
  bytesPersisted: boolean;
  mainBytes?: Blob; // ciphertext for the main object / whole chunked ciphertext
  optimizedBytes?: Blob; // ciphertext of the optimized preview
}

export interface LocalFile {
  id: string;
  key: string;
  encryptedName: string | null;
  name: string;
  size: number;
  contentType: string;
  createdAt: string;
  updatedAt: string;
  isEncrypted: boolean;
  wrappedBy?: "user" | "space";
  spaceKeyVersion?: number;
  spaceKeyWrapIv?: string;
  tags: string[];
  thumbnail?: string;
  bucketId: string;
  encryptedContentType?: string;
  encryptedDisplayName?: string;
  mediaCategory?: string;
  uploadSource?: "web" | "mobile_manual" | "mobile_backup" | "migration";
  syncContentFp?: string;
  // Preview/optimized version
  optimizedKey?: string;
  optimizedEncryptedDEK?: string;
  optimizedSpaceKeyWrapIv?: string;
  optimizedIV?: string;
  optimizedSize?: number;
  aspectRatio?: number;
}
export interface SpreadsheetDraftRecord {
  id: string;
  objectId: string;
  workspaceId: string;
  ciphertext: Blob;
  iv: string;
  baseRevision: number;
  updatedAt: number;
  schemaVersion: number;
}
export interface SpreadsheetRecentRecord {
  id: string;
  userId: string;
  objectId: string;
  workspaceId: string;
  organizationId?: string;
  lastOpenedAt: number;
}
/**
 * Sheets v2 (ONLYOFFICE) encrypted recovery snapshot. Distinct from
 * `SpreadsheetDraftRecord` (which holds v1 normalized-JSON drafts): v2 snapshots
 * are encrypted Editor.bin or exported-workbook bytes, so the two engines never
 * share a draft schema. `kind` records which of the two the ciphertext holds.
 */
export interface SpreadsheetV2DraftRecord {
  id: string;
  objectId: string;
  workspaceId: string;
  kind: "editor_bin" | "xlsx";
  ciphertext: Blob;
  iv: string;
  baseRevision: number;
  updatedAt: number;
  schemaVersion: number;
}
export class XenodeDatabase extends Dexie {
  files!: Table<LocalFile, string>;
  metadataCache!: Table<MetadataCache, string>;
  thumbnailCache!: Table<ThumbnailCache, string>;
  uploads!: Table<UploadRecord, string>;
  spreadsheetDrafts!: Table<SpreadsheetDraftRecord, string>;
  spreadsheetRecents!: Table<SpreadsheetRecentRecord, string>;
  spreadsheetV2Drafts!: Table<SpreadsheetV2DraftRecord, string>;

  constructor(userId: string) {
    super(`XenodeDB-${userId}`); // scoped per user
    this.version(1).stores({
      files:
        "id, key, encryptedName, size, contentType, createdAt, updatedAt, isEncrypted, *tags, bucketId, encryptedContentType, encryptedDisplayName, mediaCategory, optimizedKey, uploadSource, syncContentFp",
      metadataCache: "id",
      thumbnailCache: "id, lastAccessed",
    });
    // v2 adds the resumable-upload journal. Dexie inherits the v1 stores, so
    // only the new table is declared here.
    this.version(2).stores({
      uploads: "id, status, createdAt",
    });
    this.version(3).stores({
      spreadsheetDrafts: "id, objectId, workspaceId, updatedAt",
      spreadsheetRecents: "id, userId, objectId, workspaceId, organizationId, lastOpenedAt",
    });
    // v4 adds the Sheets v2 (ONLYOFFICE) encrypted recovery store, kept
    // separate from the v1 draft table so neither engine can read the other's
    // snapshot format.
    this.version(4).stores({
      spreadsheetV2Drafts: "id, objectId, workspaceId, updatedAt",
    });
  }
}

// In-memory search index — no sensitive data ever hits disk through this
export const searchIndex = new MiniSearch<LocalFile>({
  fields: ["name", "tags", "contentType"],
  storeFields: [
    "id",
    "name",
    "size",
    "contentType",
    "createdAt",
    "isEncrypted",
    "thumbnail",
    "key",
    "mediaCategory",
  ],
  searchOptions: {
    prefix: true,
    fuzzy: 0.2,
  },
});

let _db: XenodeDatabase | null = null;

export function getDb(userId: string): XenodeDatabase {
  if (!_db || (_db as any)._userId !== userId) {
    _db = new XenodeDatabase(userId);
    (_db as any)._userId = userId;
  }
  return _db;
}

/**
 * Wipe all local data for a user — call this on logout.
 */
export async function clearLocalDb(userId: string): Promise<void> {
  const database = new XenodeDatabase(userId);
  await database.delete();
  searchIndex.removeAll();
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("lastSync");
  }
  _db = null;
}

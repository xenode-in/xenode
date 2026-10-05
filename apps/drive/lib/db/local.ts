import Dexie, { Table } from "dexie";
import MiniSearch from "minisearch";
import type { SealedUploadRecord } from "@xenode/upload-engine";

export interface MetadataCache {
  id: string; // The raw base64 encrypted string acts as the ID
  plaintext: string; // The decrypted name or tag
}


export type { UploadRecord } from "@xenode/upload-engine";

export interface LocalFile {
  id: string;
  syncVersion: number;
  position?: number;
  starred?: boolean;
  key: string;
  /** Owning Space; personal and workspace objects share one regional bucket. */
  spaceId?: string;
  /** Parent folder record id, or null at the Space root. */
  folderId?: string | null;
  ancestorIds?: string[];
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
 * Office editor (ONLYOFFICE) encrypted recovery snapshot. Distinct from
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
  syncStates!: Table<{ spaceId: string; cursor: string }, string>;
  syncRemovals!: Table<{ id: string; spaceId: string; syncVersion: number }, [string, string]>;
  uploadJournal!: Table<SealedUploadRecord, string>;
  spreadsheetDrafts!: Table<SpreadsheetDraftRecord, string>;
  spreadsheetRecents!: Table<SpreadsheetRecentRecord, string>;
  spreadsheetV2Drafts!: Table<SpreadsheetV2DraftRecord, string>;

  constructor(readonly accountId: string) {
    super(`XenodeDB-${accountId}`); // scoped per user
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
    // v4 adds the Office editor (ONLYOFFICE) encrypted recovery store, kept
    // separate from the v1 draft table so neither engine can read the other's
    // snapshot format.
    this.version(4).stores({
      spreadsheetV2Drafts: "id, objectId, workspaceId, updatedAt",
    });
    // Remove the durable decrypted-thumbnail cache. Isolated thumbnails will
    // be ephemeral transferable ImageBitmaps.
    this.version(5).stores({
      thumbnailCache: null,
    });
    // v6: folders are metadata (folderId/ancestorIds) and objects are
    // partitioned by Space. Rows cached under the key-path folder model are
    // meaningless, so the cache is cleared and refilled from the server.
    this.version(6)
      .stores({
        files:
          "id, key, spaceId, folderId, *ancestorIds, encryptedName, size, contentType, createdAt, updatedAt, isEncrypted, *tags, bucketId, encryptedContentType, encryptedDisplayName, mediaCategory, optimizedKey, uploadSource, syncContentFp",
      })
      .upgrade((transaction) => transaction.table("files").clear());
    // Drop the obsolete plaintext journal; only sealed checkpoints are retained.
    this.version(7).stores({
      uploads: null,
      uploadJournal: "id,[scope.accountId+scope.spaceId],createdAt",
    });
    // Cache/cursors from timestamp sync are disposable; no compatibility reader.
    this.version(8).stores({
      metadataCache: null,
      syncStates: "spaceId",
      syncRemovals: "[spaceId+id],spaceId",
    }).upgrade((transaction) => transaction.table("files").clear());
  }
}

// In-memory search index — no sensitive data ever hits disk through this
function createSearchIndex() { return new MiniSearch<LocalFile>({
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
}); }

export class SearchIndexResource {
  private value = { version: 0, index: createSearchIndex() };
  get index() { return this.value.index; }
  private readonly listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  readonly snapshot = () => this.value;
  replace(entries: LocalFile[]) {
    const index = createSearchIndex();
    index.addAll(entries);
    this.value = { version: this.value.version + 1, index };
    this.listeners.forEach((listener) => listener());
  }
  clear() { this.replace([]); }
}
const searchIndexes = new Map<string, SearchIndexResource>();
export function getSearchIndex(accountId: string, spaceId: string): SearchIndexResource {
  const key = JSON.stringify([accountId, spaceId]);
  let resource = searchIndexes.get(key);
  if (!resource) { resource = new SearchIndexResource(); searchIndexes.set(key, resource); }
  return resource;
}

let _db: XenodeDatabase | null = null;

export function getDb(userId: string): XenodeDatabase {
  if (!_db || _db.accountId !== userId) {
    _db = new XenodeDatabase(userId);
  }
  return _db;
}

/**
 * Wipe all local data for a user — call this on logout.
 */
export async function clearLocalDb(userId: string): Promise<void> {
  const database = new XenodeDatabase(userId);
  await database.delete();
  for (const [key, resource] of searchIndexes) {
    if ((JSON.parse(key) as string[])[0] === userId) { resource.clear(); searchIndexes.delete(key); }
  }
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("lastSync");
  }
  _db = null;
}

import Dexie, { Table } from "dexie";
import MiniSearch from "minisearch";

export interface LocalFile {
  id: string;
  key: string;
  encryptedName: string | null; // raw encrypted b64 — never store plaintext
  name: string;                 // ONLY used transiently in the MiniSearch index (in-memory)
  size: number;
  contentType: string;
  createdAt: string;
  updatedAt: string;
  isEncrypted: boolean;
  tags: string[];
  thumbnail?: string;
  bucketId: string;
  encryptedContentType?: string;
  encryptedDisplayName?: string;
  mediaCategory?: string;
}

export class XenodeDatabase extends Dexie {
  files!: Table<LocalFile, string>;

  constructor(userId: string) {
    super(`XenodeDB-${userId}`); // scoped per user
    this.version(1).stores({
      files: "id, key, encryptedName, size, contentType, createdAt, updatedAt, isEncrypted, *tags, bucketId, encryptedContentType, encryptedDisplayName, mediaCategory",
    });
  }
}

// In-memory search index — no sensitive data ever hits disk through this
export const searchIndex = new MiniSearch<LocalFile>({
  fields: ["name", "tags", "contentType"],
  storeFields: ["id", "name", "size", "contentType", "createdAt", "isEncrypted", "thumbnail", "key", "mediaCategory"],
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
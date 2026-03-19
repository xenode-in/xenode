import Dexie, { Table } from "dexie";
import MiniSearch from "minisearch";

export interface LocalFile {
  id: string; // The MongoDB _id
  key: string;
  name: string; // Plaintext decrypted name
  size: number;
  contentType: string;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  isEncrypted: boolean;
  encryptedName?: string;
  tags: string[];
  thumbnail?: string;
  bucketId: string;
}

export class XenodeDatabase extends Dexie {
  files!: Table<LocalFile, string>;

  constructor() {
    super("XenodeDB");
    
    // Schema
    this.version(1).stores({
      files: "id, key, name, size, contentType, createdAt, updatedAt, isEncrypted, *tags, bucketId",
    });
  }
}

export const db = new XenodeDatabase();

// In-memory search index
export const searchIndex = new MiniSearch({
  fields: ["name", "tags", "contentType"], // fields to index for full-text search
  storeFields: ["id", "name", "size", "contentType", "createdAt", "isEncrypted", "thumbnail", "key", "encryptedName"], // fields to return with search results
  searchOptions: {
    prefix: true,
    fuzzy: 0.2, // typo tolerance
  },
});

/**
 * Sync Dexie data into MiniSearch on boot
 */
export async function initializeSearchIndex() {
  const allFiles = await db.files.toArray();
  searchIndex.removeAll();
  searchIndex.addAll(allFiles);
}

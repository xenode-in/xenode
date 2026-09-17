import { mongo } from "mongoose";
import { getDatabase } from "../connection";

interface StorageReferences {
  key?: string;
  thumbnail?: string;
  optimizedKey?: string;
  chunks?: Array<{ key?: string }>;
  versions?: Array<{ key?: string; chunks?: Array<{ key?: string }> }>;
}

/**
 * Cleanup safety check across all products and retained states, including Bin
 * objects. This does not authorize deletion: callers must separately establish
 * ownership of every candidate key via their upload ledger.
 * Call after connecting through the shared database connection.
 */
export async function findReferencedStorageObjectKeys(args: {
  bucketId: string | mongo.ObjectId;
  keys: readonly string[];
}): Promise<Set<string>> {
  const candidates = [...new Set(args.keys.filter(Boolean))];
  const referenced = new Set<string>();
  const bucketId = typeof args.bucketId === "string"
    ? new mongo.ObjectId(args.bucketId)
    : args.bucketId;
  // Bound both the query and projection to the keys needed for this cleanup.
  for (let offset = 0; offset < candidates.length; offset += 1000) {
    const keys = candidates.slice(offset, offset + 1000);
    const wanted = new Set(keys);
    const fields = ["key", "thumbnail", "optimizedKey", "chunks.key", "versions.key", "versions.chunks.key"];
    const cursor = getDatabase().collection<StorageReferences>("storageobjects")
      .find({ bucketId, $or: fields.map((field) => ({ [field]: { $in: keys } })) })
      .project<StorageReferences>(Object.fromEntries(fields.map((field) => [field, 1])));
    for await (const object of cursor) {
      const storedKeys = [
        object.key, object.thumbnail, object.optimizedKey,
        ...(object.chunks ?? []).map((chunk) => chunk.key),
        ...(object.versions ?? []).flatMap((version) => [
          version.key, ...(version.chunks ?? []).map((chunk) => chunk.key),
        ]),
      ];
      for (const key of storedKeys) {
        if (key && wanted.has(key)) referenced.add(key);
      }
    }
  }
  return referenced;
}

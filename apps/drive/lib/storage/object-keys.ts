import type { IStorageObjectVersion } from "@/models/StorageObject";
import { collectVersionB2Keys } from "./versions";

export interface StoredObjectKeys {
  key?: string;
  thumbnail?: string;
  optimizedKey?: string;
  chunks?: Array<{ key: string }>;
  versions?: IStorageObjectVersion[];
}

/** Physical current, derivative and retained-version keys, without duplicates. */
export function collectStorageObjectKeys(object: StoredObjectKeys): string[] {
  return [...new Set([
    object.key,
    object.optimizedKey,
    // Older records may contain an inline encrypted/data thumbnail instead.
    object.thumbnail && /^(?:users|workspaces|shares)\//u.test(object.thumbnail)
      ? object.thumbnail : undefined,
    ...(object.chunks ?? []).map((chunk) => chunk.key),
    ...(object.versions ?? []).flatMap(collectVersionB2Keys),
  ].filter((key): key is string => typeof key === "string" && key.length > 0))];
}

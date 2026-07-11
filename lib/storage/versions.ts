import { randomBytes } from "crypto";
import type { IStorageObject, IStorageObjectVersion } from "@/models/StorageObject";

/**
 * Maximum retained versions per object. On overwrite, the previous content is
 * pushed to the front of `versions[]`; anything past this cap is evicted (its B2
 * blob deleted and its bytes freed from quota). Versions count against storage.
 */
export const MAX_VERSIONS_PER_OBJECT = 10;

/** Short, collision-resistant id for a version entry. */
export function newVersionId(): string {
  return randomBytes(12).toString("hex");
}

/** Fresh opaque B2 object key for new content (never derived from a filename). */
export function newObjectKey(ownerId: string, prefix = `users/${ownerId}/`): string {
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return `${normalizedPrefix}${randomBytes(16).toString("hex")}`;
}

/**
 * Build a version entry from an object's CURRENT content fields, attributing it
 * to `actorUserId`. Call this BEFORE overwriting the object's current pointers.
 */
export function snapshotCurrentAsVersion(
  object: IStorageObject,
  actorUserId: string,
  options: { isOriginal?: boolean; sharesCurrentContent?: boolean } = {},
): IStorageObjectVersion {
  return {
    versionId: newVersionId(),
    isOriginal: options.isOriginal ?? false,
    sharesCurrentContent: options.sharesCurrentContent ?? false,
    key: object.key,
    b2FileId: object.b2FileId,
    size: object.size,
    contentType: object.contentType,
    encryptedDEK: object.encryptedDEK,
    wrappedBy: object.wrappedBy,
    spaceKeyId: object.spaceKeyId,
    spaceKeyVersion: object.spaceKeyVersion,
    spaceKeyWrapIv: object.spaceKeyWrapIv,
    iv: object.iv,
    chunkSize: object.chunkSize,
    chunkCount: object.chunkCount,
    chunkIvs: object.chunkIvs,
    chunks: object.chunks?.map((c) => ({ index: c.index, key: c.key, size: c.size })),
    encryptedMetadata: object.encryptedMetadata,
    // The archived content was "current" until now — stamp when it was archived.
    createdAt: object.updatedAt ?? new Date(),
    createdBy: actorUserId,
  };
}

/** Every B2 key a single version occupies (main blob + any chunk blobs). */
export function collectVersionB2Keys(version: IStorageObjectVersion): string[] {
  const keys: string[] = [];
  if (version.key) keys.push(version.key);
  for (const chunk of version.chunks ?? []) {
    if (chunk.key) keys.push(chunk.key);
  }
  return keys;
}

/**
 * Split a versions list into the entries to KEEP (newest `MAX`) and the ones to
 * EVICT (the overflow). Input is assumed newest-first.
 */
export function evictOverflow(versions: IStorageObjectVersion[]): {
  kept: IStorageObjectVersion[];
  evicted: IStorageObjectVersion[];
} {
  if (versions.length <= MAX_VERSIONS_PER_OBJECT) {
    return { kept: versions, evicted: [] };
  }

  // The immutable original is part of the ten retained entries but is never
  // evicted. The other nine slots remain newest-first rolling history.
  const original = versions.find((version) => version.isOriginal);
  if (!original) {
    return {
      kept: versions.slice(0, MAX_VERSIONS_PER_OBJECT),
      evicted: versions.slice(MAX_VERSIONS_PER_OBJECT),
    };
  }
  const rolling = versions.filter((version) => version !== original);
  const rollingLimit = MAX_VERSIONS_PER_OBJECT - 1;
  return {
    kept: [...rolling.slice(0, rollingLimit), original],
    evicted: rolling.slice(rollingLimit),
  };
}

/** Sum of bytes a set of versions occupy (main + chunks). */
export function versionsTotalBytes(versions: IStorageObjectVersion[]): number {
  return versions.reduce((sum, v) => {
    if (v.sharesCurrentContent) return sum;
    const chunkBytes = (v.chunks ?? []).reduce((s, c) => s + (c.size || 0), 0);
    // For chunked versions `size` is plaintext total; the bytes actually stored
    // are the chunk blobs. For non-chunked, `size` is the stored blob size.
    return sum + (chunkBytes > 0 ? chunkBytes : v.size || 0);
  }, 0);
}

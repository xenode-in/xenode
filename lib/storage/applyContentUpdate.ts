import StorageObject, { IStorageObject } from "@/models/StorageObject";
import { uploadObject, deleteObjects } from "@/lib/b2/objects";
import { updateBucketStats } from "@/lib/metering/usage";
import { revisionFilter } from "@/lib/storage/revisions";
import {
  snapshotCurrentAsVersion,
  newObjectKey,
  evictOverflow,
  collectVersionB2Keys,
  versionsTotalBytes,
} from "@/lib/storage/versions";

export interface ApplyContentUpdateArgs {
  /** Hydrated mongoose doc — NOT lean. */
  object: IStorageObject;
  bucket: { b2BucketId: string };
  buffer: Buffer;
  iv: string;
  /** Optional rotated DEK wrap (owner path only). */
  encryptedDEK?: string | null;
  /** Version attribution — the recipient's id for share-authorized saves. */
  actorUserId: string;
  baseRevision: number | null;
  /** Owner-derived object key prefix (org workspace or personal). */
  newKeyPrefix: string;
  /** Owner-attributed quota adjustment; throws QUOTA_EXCEEDED. */
  adjustWorkspaceStorage: (delta: number) => Promise<unknown>;
}

export type ApplyContentUpdateResult =
  | { ok: true; revision: number; object: IStorageObject | null }
  | { ok: false; code: "revision_conflict"; revision: number };

/**
 * Overwrites an object's content, KEEPING the previous content as a version
 * (newest-first, capped at MAX_VERSIONS_PER_OBJECT). The new ciphertext is
 * written to a *fresh* B2 key so the prior bytes are never clobbered — no
 * server-side ciphertext copy is needed, which keeps the E2EE boundary intact.
 *
 * Shared by the owner route (/api/objects/[id]/update-content) and the
 * share-editor route (/api/direct-shares/[id]/update-content). Callers are
 * responsible for authorization and for deriving `newKeyPrefix` /
 * `adjustWorkspaceStorage` from the object's OWNER workspace.
 */
export async function applyContentUpdate({
  object,
  bucket,
  buffer,
  iv,
  encryptedDEK,
  actorUserId,
  baseRevision,
  newKeyPrefix,
  adjustWorkspaceStorage,
}: ApplyContentUpdateArgs): Promise<ApplyContentUpdateResult> {
  // 1. Snapshot the current content before mutating fields. Spreadsheet
  // originals are pinned and never duplicated when the current pointer is
  // already referencing that immutable source ciphertext.
  const existingVersions = [...(object.versions || [])];
  let versionCandidates: typeof existingVersions;
  if (object.mediaCategory === "excel") {
    let original = existingVersions.find((version) => version.isOriginal);
    if (!original && existingVersions.length > 0) {
      original = existingVersions[existingVersions.length - 1];
      original.isOriginal = true;
      original.sharesCurrentContent = original.key === object.key;
    }
    if (!original) {
      original = snapshotCurrentAsVersion(object, actorUserId, {
        isOriginal: true,
        sharesCurrentContent: true,
      });
      existingVersions.push(original);
    }
    const currentIsPinnedOriginal = original.key === object.key;
    if (currentIsPinnedOriginal) original.sharesCurrentContent = false;
    versionCandidates = currentIsPinnedOriginal
      ? existingVersions
      : [snapshotCurrentAsVersion(object, actorUserId), ...existingVersions];
  } else {
    versionCandidates = [
      snapshotCurrentAsVersion(object, actorUserId),
      ...existingVersions,
    ];
  }
  const { kept, evicted } = evictOverflow(versionCandidates);
  const evictedBytes = versionsTotalBytes(evicted);
  const newSize = buffer.byteLength;

  // 2. Reserve quota FIRST (atomic + enforced). The retained old version now
  //    also occupies space, so the net delta is +newSize − evictedBytes.
  const netDelta = newSize - evictedBytes;
  if (netDelta !== 0) {
    await adjustWorkspaceStorage(netDelta); // throws QUOTA_EXCEEDED
  }

  // 3. Upload NEW content to a fresh key. Roll back the reservation on fail.
  const newKey = newObjectKey(actorUserId, newKeyPrefix);
  let uploadResult;
  try {
    uploadResult = await uploadObject(
      bucket.b2BucketId,
      newKey,
      buffer,
      "application/octet-stream",
      newSize,
    );
  } catch (uploadErr) {
    if (netDelta !== 0) {
      await adjustWorkspaceStorage(-netDelta).catch(() => {});
    }
    throw uploadErr;
  }

  // 4. Atomically point the object at the new ciphertext. A second editor
  // may have saved while this upload was in flight, so the revision guard
  // must be part of the database write rather than only a preflight check.
  const expectedRevision = baseRevision ?? (object.revision ?? 0);
  const update = await StorageObject.updateOne(
    { _id: object._id, ...revisionFilter(expectedRevision) },
    {
      $set: {
        key: newKey,
        b2FileId: uploadResult.b2FileId,
        size: newSize,
        iv,
        ...(encryptedDEK ? { encryptedDEK } : {}),
        versions: kept,
        updatedAt: new Date(),
      },
      $inc: { revision: 1 },
    },
  );
  if (update.matchedCount !== 1) {
    await deleteObjects(bucket.b2BucketId, [newKey]).catch(() => {});
    if (netDelta !== 0) await adjustWorkspaceStorage(-netDelta).catch(() => {});
    const latest = await StorageObject.findById(object._id)
      .select("revision")
      .lean();
    return {
      ok: false,
      code: "revision_conflict",
      revision: latest?.revision ?? expectedRevision,
    };
  }
  const updatedObject = await StorageObject.findById(object._id);

  // 5. Best-effort: drop evicted version blobs + reconcile bucket stats.
  if (evicted.length > 0) {
    await deleteObjects(
      bucket.b2BucketId,
      evicted.flatMap(collectVersionB2Keys),
    );
  }
  if (netDelta !== 0) {
    await updateBucketStats(object.bucketId.toString(), 0, netDelta);
  }

  return {
    ok: true,
    revision: updatedObject?.revision ?? expectedRevision + 1,
    object: updatedObject,
  };
}

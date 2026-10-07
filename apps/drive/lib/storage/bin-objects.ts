import { binDriveObjects } from "@xenode/database";
import type { AccessContext } from "@/lib/authz/space-context";
import { removeObjectsFromAlbums } from "@/lib/albums/cleanup";
import { publishSyncEvent } from "@/lib/realtime/publish";
import { ActivityAction, emitActivity } from "@/lib/orgs/activity";
import { folderListingId, isFolderObject } from "@/lib/storage/folders";
import DirectShare from "@/models/DirectShare";
import ShareLink from "@/models/ShareLink";

/**
 * Move a selection to the Bin: folders take their live subtree, files their
 * sidecars, all with one shared `deletedAt` (see `binDriveObjects`). Blobs and
 * metering stay until purge. A binned item must not stay reachable, so shares
 * and album references are retired; restore does not revive them.
 */
export async function binObjectsInSpace(ctx: AccessContext, objectIds: unknown) {
  const { binnedIds, primaries } = await binDriveObjects({
    spaceId: ctx.spaceId,
    objectIds,
  });
  if (!binnedIds.length) return { binnedCount: 0, objectIds: [] as string[] };
  await ShareLink.deleteMany({ objectId: { $in: binnedIds } });
  await DirectShare.deleteMany({ objectId: { $in: binnedIds } });
  await removeObjectsFromAlbums(ctx.spaceId, ctx.userId, binnedIds);
  await publishSyncEvent({
    userId: ctx.userId,
    spaceId: ctx.spaceId,
    type: primaries.some(isFolderObject) ? "FOLDER_DELETED" : "FILE_DELETED",
    payload: {
      objectIds: binnedIds.map(String),
      folderIds: [...new Set(primaries.map((object) => folderListingId(object.folderId)))],
    },
    invalidateFolders: primaries.map((object) => object.folderId ?? null),
    invalidateRecent: true,
  });
  if (ctx.organizationId) {
    for (const object of primaries) {
      await emitActivity({
        orgId: ctx.organizationId, action: ActivityAction.FILE_DELETED, actorUserId: ctx.userId,
        target: { type: isFolderObject(object) ? "folder" : "object", id: String(object._id) },
      });
    }
  }
  return { binnedCount: binnedIds.length, objectIds: binnedIds.map(String) };
}

/** Folder listings are per Space and folder, shared by every member. */
export function folderVersionKey(spaceId: string, folderId: string): string {
  return `folder-version:${spaceId}:${folderId}`;
}

export function folderResponseKey(params: {
  spaceId: string;
  folderId: string;
  version: string;
  limit: number;
  sortBy: string;
  sortDir: string;
}): string {
  const { spaceId, folderId, version, limit, sortBy, sortDir } = params;
  return `folder:${spaceId}:${folderId}:v${version}:${sortBy}:${sortDir}:${limit}`;
}

/** Usage is a property of the Space, shared by every member who can read it. */
export function storageCacheKey(spaceId: string): string {
  return `storage:space:${spaceId}`;
}

export function recentCacheKey(userId: string): string {
  return `recent:${userId}`;
}

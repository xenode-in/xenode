export function folderVersionKey(
  userId: string,
  bucketId: string,
  prefix: string,
): string {
  return `folder-version:${userId}:${bucketId}:${prefix}`;
}

export function folderResponseKey(params: {
  userId: string;
  bucketId: string;
  prefix: string;
  version: string;
  limit: number;
  sortBy: string;
  sortDir: string;
}): string {
  const { userId, bucketId, prefix, version, limit, sortBy, sortDir } = params;
  const encodedPrefix = Buffer.from(prefix).toString("base64url");
  return `folder:${userId}:${bucketId}:${encodedPrefix}:v${version}:${sortBy}:${sortDir}:${limit}`;
}

/** Usage is a property of the Space, shared by every member who can read it. */
export function storageCacheKey(spaceId: string): string {
  return `storage:space:${spaceId}`;
}

export function recentCacheKey(userId: string): string {
  return `recent:${userId}`;
}

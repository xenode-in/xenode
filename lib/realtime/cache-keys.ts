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

export function storageCacheKey(userId: string): string {
  return `storage:${userId}`;
}

export function recentCacheKey(userId: string): string {
  return `recent:${userId}`;
}

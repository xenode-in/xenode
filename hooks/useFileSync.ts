import { useInfiniteQuery } from "@tanstack/react-query";
import { getDb, LocalFile } from "@/lib/db/local";

interface FetchObjectsParams {
  bucketId: string | null;
  userId: string | null;
  limit?: number;
  sortBy?: "date" | "size" | "type" | "name";
  sortDir?: "asc" | "desc";
}

export function useFileSync({
  bucketId,
  userId,
  limit = 100,
  sortBy = "date",
  sortDir = "desc",
}: FetchObjectsParams) {
  return useInfiniteQuery({
    queryKey: ["files", bucketId, sortBy, sortDir],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      if (!bucketId || !userId)
        return { objects: [], hasNextPage: false, nextCursor: null };

      let url = `/api/objects?bucketId=${bucketId}&limit=${limit}&sortBy=${sortBy}&sortDir=${sortDir}`;
      if (pageParam) {
        url += `&before=${encodeURIComponent(pageParam)}`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch objects");

      const data = await res.json();

      // Upsert into Dexie
      if (data.objects && data.objects.length > 0) {
        const db = getDb(userId);
        const mappedFiles: LocalFile[] = data.objects.map((o: any) => ({
          id: o._id || o.id,
          key: o.key,
          encryptedName: o.encryptedName || o.encryptedDisplayName || null,
          name: o.key.split("/").pop() || "", // Temporary fallback
          size: o.size || 0,
          contentType: o.contentType || "",
          createdAt: o.createdAt || new Date().toISOString(),
          updatedAt: o.updatedAt || new Date().toISOString(),
          isEncrypted: o.isEncrypted || false,
          tags: o.tags || [],
          thumbnail: o.thumbnail,
          bucketId: bucketId,
          encryptedContentType: o.encryptedContentType,
          encryptedDisplayName: o.encryptedDisplayName,
          mediaCategory: o.mediaCategory,
          optimizedKey: o.optimizedKey,
          optimizedEncryptedDEK: o.optimizedEncryptedDEK,
          optimizedIV: o.optimizedIV,
          optimizedSize: o.optimizedSize,
        }));

        await db.files.bulkPut(mappedFiles);
      }

      return {
        objects: data.objects,
        hasNextPage: data.pagination?.hasNextPage || false,
        nextCursor: data.pagination?.nextCursor || null,
      };
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasNextPage) return undefined;
      return lastPage.nextCursor;
    },
    enabled: !!bucketId && !!userId,
  });
}

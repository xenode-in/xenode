import { useInfiniteQuery } from "@tanstack/react-query";
import { getDb } from "@/lib/db/local";
import {
  mapServerObjectToLocalFile,
  ServerObject,
} from "@/lib/db/object-cache";

interface FetchObjectsParams {
  bucketId: string | null;
  userId: string | null;
  limit?: number;
  sortBy?: "date" | "size" | "type" | "name";
  sortDir?: "asc" | "desc";
  mediaCategory?: string | null;
  fetchAll?: boolean;
  excludeMobileBackup?: boolean;
}

export function useFileSync({
  bucketId,
  userId,
  limit = 100,
  sortBy = "date",
  sortDir = "desc",
  mediaCategory,
  fetchAll = false,
  excludeMobileBackup = false,
}: FetchObjectsParams) {
  return useInfiniteQuery({
    queryKey: [
      "files",
      bucketId,
      sortBy,
      sortDir,
      mediaCategory,
      fetchAll,
      excludeMobileBackup,
    ],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      if (!bucketId || !userId)
        return { objects: [], hasNextPage: false, nextCursor: null };

      let url = `/api/objects?bucketId=${bucketId}&limit=${limit}&sortBy=${sortBy}&sortDir=${sortDir}`;

      // E2EE: server can't sort by encrypted file names, so fetch all
      // metadata in a single call and let the client sort after decryption.
      if (sortBy === "name" || fetchAll) {
        url += "&fetchAll=true";
      }

      if (mediaCategory) {
        url += `&mediaCategory=${encodeURIComponent(mediaCategory)}`;
      }
      if (excludeMobileBackup) {
        url += "&excludeMobileBackup=true";
      }
      if (pageParam) {
        url += `&before=${encodeURIComponent(pageParam)}`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch objects");

      const data = await res.json();

      // Upsert into Dexie
      if (data.objects && data.objects.length > 0) {
        const db = getDb(userId);
        const mappedFiles = (data.objects as ServerObject[]).map((o) =>
          mapServerObjectToLocalFile(o, bucketId),
        );

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

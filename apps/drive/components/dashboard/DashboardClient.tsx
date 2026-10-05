"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/local";
import { useSession } from "@/lib/auth/client";
import { useWorkspace, driveScopeSpaceId } from "@/contexts/WorkspaceContext";
import { QuickAccessBar } from "@/components/dashboard/QuickAccessBar";
import { PreviewSection } from "@/components/dashboard/PreviewSection";
import { RecentFilesTable } from "@/components/dashboard/RecentFilesTable";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RecentObject = any;

export function DashboardClient() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const workspace = useWorkspace();
  const { scopedFetch } = workspace;
  const spaceId = userId ? driveScopeSpaceId(workspace.driveScope, userId) : "";

  // "Recent" = recently OPENED, sorted server-side by lastAccessedAt (bumped on
  // every file open, seeded at upload). Fetched from the server so it reflects
  // opens immediately, rather than the Dexie createdAt order (recent uploads).
  const [loadedRecent, setLoadedRecent] = useState<{ spaceId: string; userId: string; files: RecentObject[] } | null>(null);
  const recentFiles = loadedRecent?.spaceId === spaceId && loadedRecent.userId === userId ? loadedRecent.files : null;

  useEffect(() => {
    if (!userId || !spaceId) return;
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const cfgRes = await scopedFetch("/api/drive/config", { signal: controller.signal });
        const cfg = await cfgRes.json();
        const bid = cfg?.bucket?._id;
        if (!bid) {
          if (!cancelled) setLoadedRecent({ userId, spaceId, files: [] });
          return;
        }
        const res = await scopedFetch(
          `/api/objects?bucketId=${bid}&sortBy=accessed&limit=8`,
          { signal: controller.signal },
        );
        const data = await res.json();
        const objs = (data.objects ?? []).map((o: RecentObject) => ({
          ...o,
          id: o._id,
          encryptedName: o.encryptedName ?? undefined,
        }));
        if (!cancelled) setLoadedRecent({ userId, spaceId, files: objs });
      } catch {
        if (!cancelled) setLoadedRecent({ userId, spaceId, files: [] });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [userId, spaceId, scopedFetch]);

  const videos = useLiveQuery(
    () =>
      userId
        ? getDb(userId)
            .files.where("spaceId").equals(spaceId).filter((f) => f.contentType.startsWith("video/"))
            .reverse()
            .limit(1)
            .toArray()
        : [],
    [userId, spaceId],
  );

  const images = useLiveQuery(
    () =>
      userId
        ? getDb(userId)
            .files.where("spaceId").equals(spaceId).filter((f) => f.contentType.startsWith("image/"))
            .reverse()
            .limit(4)
            .toArray()
        : [],
    [userId, spaceId],
  );

  const audios = useLiveQuery(
    () =>
      userId
        ? getDb(userId)
            .files.where("spaceId").equals(spaceId).filter((f) => f.contentType.startsWith("audio/"))
            .reverse()
            .limit(1)
            .toArray()
        : [],
    [userId, spaceId],
  );

  // Still loading Dexie query
  if (!recentFiles) {
    return (
      <div className="p-8 text-center text-muted-foreground animate-pulse">
        Loading secure vault...
      </div>
    );
  }

  const hasPreview =
    (videos && videos.length > 0) ||
    (images && images.length > 0) ||
    (audios && audios.length > 0);

  const mapToObjects = (files: import("@/lib/db/local").LocalFile[]) =>
    files.map((f) => ({ ...f, encryptedName: f.encryptedName ?? undefined }));

  return (
    <div className="space-y-8">
      {/* Quick Access */}
      <QuickAccessBar />

      {/* Preview */}
      {hasPreview && (
        <PreviewSection
          videos={mapToObjects(videos || [])}
          images={mapToObjects(images || [])}
          audios={mapToObjects(audios || [])}
        />
      )}

      {/* Recent Files */}
      <RecentFilesTable files={recentFiles || []} />

      {/* Empty state */}
      {recentFiles.length === 0 && !hasPreview && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/5 border border-border flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-muted-foreground/20"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
          </div>
          <p className="text-sm text-muted-foreground mb-1">No files yet</p>
          <p className="text-xs text-muted-foreground/50">
            Upload files in{" "}
            <a href="/dashboard/files" className="text-primary hover:underline">
              My Files
            </a>{" "}
            to see them here.
          </p>
        </div>
      )}
    </div>
  );
}

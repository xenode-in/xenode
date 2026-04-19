"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/local";
import { useSession } from "@/lib/auth/client";
import { QuickAccessBar } from "@/components/dashboard/QuickAccessBar";
import { PreviewSection } from "@/components/dashboard/PreviewSection";
import { RecentFilesTable } from "@/components/dashboard/RecentFilesTable";

export function DashboardClient() {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const recentFiles = useLiveQuery(
    () => userId ? getDb(userId).files.orderBy('createdAt').reverse().limit(8).toArray() : [],
    [userId]
  );

  const videos = useLiveQuery(
    () => userId ? getDb(userId).files
      .filter(f => f.contentType.startsWith("video/"))
      .reverse()
      .limit(1)
      .toArray() : [],
    [userId]
  );

  const images = useLiveQuery(
    () => userId ? getDb(userId).files
      .filter(f => f.contentType.startsWith("image/"))
      .reverse()
      .limit(4)
      .toArray() : [],
    [userId]
  );

  const audios = useLiveQuery(
    () => userId ? getDb(userId).files
      .filter(f => f.contentType.startsWith("audio/"))
      .reverse()
      .limit(1)
      .toArray() : [],
    [userId]
  );

  // Still loading Dexie query
  if (!recentFiles) {
    return <div className="p-8 text-center text-muted-foreground animate-pulse">Loading secure vault...</div>;
  }

  const hasPreview = (videos && videos.length > 0) || (images && images.length > 0) || (audios && audios.length > 0);

  const mapToObjects = (files: import("@/lib/db/local").LocalFile[]) => files.map(f => ({ ...f, encryptedName: f.encryptedName ?? undefined }));

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
      <RecentFilesTable files={mapToObjects(recentFiles || [])} />

      {/* Empty state */}
      {recentFiles.length === 0 && !hasPreview && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/5 border border-border flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-muted-foreground/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
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

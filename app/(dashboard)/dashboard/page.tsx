import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import StorageObject from "@/models/StorageObject";
import Bucket from "@/models/Bucket";
import { QuickAccessBar } from "@/components/dashboard/QuickAccessBar";
import { PreviewSection } from "@/components/dashboard/PreviewSection";
import { RecentFilesTable } from "@/components/dashboard/RecentFilesTable";

const LIST_PROJECTION = "key size contentType thumbnail createdAt isEncrypted";

interface ObjectDoc {
  _id: unknown;
  key: string;
  size: number;
  contentType: string;
  createdAt: Date;
  thumbnail?: string;
  isEncrypted?: boolean;
}

async function getDashboardData(userId: string) {
  await dbConnect();

  // Find the user's drive bucket
  const systemBucket = await Bucket.findOne({ userId: "system" })
    .select("_id")
    .lean();

  const userBucket = await Bucket.findOne({ userId })
    .select("_id")
    .lean();

  const bucket = userBucket || systemBucket;
  if (!bucket) {
    return { videos: [], images: [], audios: [], recentFiles: [] };
  }

  const bucketId = bucket._id;
  const prefix = `users/${userId}/`;
  const baseQuery = systemBucket && !userBucket
    ? { bucketId, key: { $gte: prefix, $lt: prefix + "\uffff" } }
    : { bucketId };

  const [videos, images, audios, recentFiles] = await Promise.all([
    StorageObject.find({ ...baseQuery, contentType: { $regex: /^video\//i } })
      .select(LIST_PROJECTION)
      .sort({ createdAt: -1 })
      .limit(1)
      .lean(),
    StorageObject.find({ ...baseQuery, contentType: { $regex: /^image\//i } })
      .select(LIST_PROJECTION)
      .sort({ createdAt: -1 })
      .limit(4)
      .lean(),
    StorageObject.find({ ...baseQuery, contentType: { $regex: /^audio\//i } })
      .select(LIST_PROJECTION)
      .sort({ createdAt: -1 })
      .limit(1)
      .lean(),
    StorageObject.find(baseQuery)
      .select(LIST_PROJECTION)
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
  ]);

  function toPlain(docs: ObjectDoc[]) {
    return docs.map((d) => ({
      id: String(d._id),
      key: d.key,
      size: d.size,
      contentType: d.contentType,
      createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
      thumbnail: d.thumbnail,
      isEncrypted: d.isEncrypted,
    }));
  }

  return {
    videos: toPlain(videos as ObjectDoc[]),
    images: toPlain(images as ObjectDoc[]),
    audios: toPlain(audios as ObjectDoc[]),
    recentFiles: toPlain(recentFiles as ObjectDoc[]),
  };
}

export default async function DashboardPage() {
  const session = await requireAuth();
  const { videos, images, audios, recentFiles } = await getDashboardData(
    session.user.id
  );

  const hasPreview = videos.length > 0 || images.length > 0 || audios.length > 0;

  return (
    <div className="space-y-8">
      {/* Quick Access */}
      <QuickAccessBar />

      {/* Preview */}
      {hasPreview && (
        <PreviewSection
          videos={videos}
          images={images}
          audios={audios}
        />
      )}

      {/* Recent Files */}
      <RecentFilesTable files={recentFiles} />

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

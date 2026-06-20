import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import StorageObject from "@/models/StorageObject";
import { bytesToGB, formatBytes } from "@/lib/utils/format";
import {
  Archive,
  Code2,
  FileAudio,
  FileText,
  HardDrive,
  ImageIcon,
  Video,
} from "lucide-react";
import { StorageChart } from "@/components/dashboard/StorageChart";

function normalizeCategory(category: string | null | undefined): string {
  switch (category) {
    case "image":
      return "Images";
    case "video":
      return "Videos";
    case "audio":
      return "Audio";
    case "document":
    case "pdf":
    case "word":
    case "excel":
    case "powerpoint":
      return "Documents";
    case "archive":
      return "Archives";
    case "code":
      return "Code";
    default:
      return "Other";
  }
}

const CATEGORY_META = {
  Images: { icon: ImageIcon, color: "#5B8DEF" },
  Videos: { icon: Video, color: "#43A047" },
  Audio: { icon: FileAudio, color: "#F59E0B" },
  Documents: { icon: FileText, color: "#EC4899" },
  Archives: { icon: Archive, color: "#8B5CF6" },
  Code: { icon: Code2, color: "#06B6D4" },
  Other: { icon: HardDrive, color: "#71717A" },
};

export default async function UsagePage() {
  const session = await requireAuth();
  const userId = session.user.id;

  await dbConnect();

  const [usage, rawBreakdown] = await Promise.all([
    Usage.findOne({ userId }).lean(),
    StorageObject.aggregate<{ _id: string | null; bytes: number; count: number }>([
      { $match: { userId } },
      {
        $group: {
          _id: "$mediaCategory",
          bytes: { $sum: "$size" },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const u = usage || {
    totalStorageBytes: 0,
    storageLimitBytes: 1099511627776,
    totalBuckets: 0,
    totalObjects: 0,
  };

  const storageLimitGB =
    u.storageLimitBytes === null ? "Unlimited" : bytesToGB(u.storageLimitBytes);
  const grouped = new Map<string, { bytes: number; count: number }>();
  for (const item of rawBreakdown) {
    const category = normalizeCategory(item._id);
    const prev = grouped.get(category) ?? { bytes: 0, count: 0 };
    grouped.set(category, {
      bytes: prev.bytes + item.bytes,
      count: prev.count + item.count,
    });
  }
  const breakdown = Array.from(grouped.entries())
    .map(([category, item]) => ({ category, ...item }))
    .sort((a, b) => b.bytes - a.bytes);

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Usage
        </h1>
        <p className="text-muted-foreground mt-2">
          Monitor your storage consumption across all buckets.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2 rounded-lg bg-primary/10">
              <HardDrive className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              Storage Overview
            </h2>
          </div>

          <StorageChart
            usedBytes={u.totalStorageBytes}
            totalBytes={u.storageLimitBytes}
          />

          <div className="mt-8 space-y-4">
            <div className="flex justify-between items-center text-sm border-b border-border/50 pb-3">
              <span className="text-muted-foreground">Current Usage</span>
              <span className="font-medium text-foreground">
                {formatBytes(u.totalStorageBytes)}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm pt-1">
              <span className="text-muted-foreground">Storage Limit</span>
              <span className="font-medium text-foreground">
                {storageLimitGB === "Unlimited"
                  ? "Unlimited"
                  : `${storageLimitGB} GB`}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm pt-1">
              <span className="text-muted-foreground">Remaining</span>
              <span className="font-medium text-foreground">
                {u.storageLimitBytes === null
                  ? "Unlimited"
                  : formatBytes(Math.max(u.storageLimitBytes - u.totalStorageBytes, 0))}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              Storage by File Type
            </h2>
          </div>

          <div className="space-y-4">
            {breakdown.length ? (
              breakdown.map((item) => {
                const meta =
                  CATEGORY_META[item.category as keyof typeof CATEGORY_META] ??
                  CATEGORY_META.Other;
                const Icon = meta.icon;
                const percent =
                  u.totalStorageBytes > 0
                    ? Math.min((item.bytes / u.totalStorageBytes) * 100, 100)
                    : 0;
                return (
                  <div key={item.category} className="space-y-2">
                    <div className="flex items-center gap-3">
                      <div
                        className="h-9 w-9 rounded-xl flex items-center justify-center"
                        style={{ backgroundColor: `${meta.color}22` }}
                      >
                        <Icon className="h-4 w-4" style={{ color: meta.color }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-4">
                          <p className="font-medium text-foreground">
                            {item.category}
                          </p>
                          <p className="text-sm font-semibold text-foreground">
                            {formatBytes(item.bytes)}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {item.count} file{item.count === 1 ? "" : "s"} ·{" "}
                          {percent.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${percent}%`,
                          backgroundColor: meta.color,
                        }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">
                No uploaded files yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

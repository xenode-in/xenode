import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import Bucket from "@/models/Bucket";
import { bytesToGB, formatBytes } from "@/lib/utils/format";
import { HardDrive, FolderOpen, FileText, ArrowUpFromLine } from "lucide-react";

async function getDashboardData(userId: string) {
  await dbConnect();

  const [usage, recentBuckets] = await Promise.all([
    Usage.findOne({ userId }).lean(),
    Bucket.find({ userId }).sort({ createdAt: -1 }).limit(5).lean(),
  ]);

  return {
    usage: usage || {
      totalStorageBytes: 0,
      totalEgressBytes: 0,
      totalObjects: 0,
      totalBuckets: 0,
      storageLimitBytes: 1099511627776,
      egressLimitBytes: 536870912000,
    },
    recentBuckets,
  };
}

export default async function DashboardPage() {
  const session = await requireAuth();
  const { usage, recentBuckets } = await getDashboardData(session.user.id);

  const storageUsedGB = bytesToGB(usage.totalStorageBytes);
  const storageLimitGB = bytesToGB(usage.storageLimitBytes || 0);
  const storagePercent =
    storageLimitGB > 0
      ? Math.min((storageUsedGB / storageLimitGB) * 100, 100)
      : 0;

  const egressUsedGB = bytesToGB(usage.totalEgressBytes);
  const egressLimitGB = bytesToGB(usage.egressLimitBytes);
  const egressPercent =
    egressLimitGB > 0 ? Math.min((egressUsedGB / egressLimitGB) * 100, 100) : 0;

  const stats = [
    {
      label: "Total Storage",
      value: formatBytes(usage.totalStorageBytes),
      limit: `of ${storageLimitGB} GB`,
      icon: HardDrive,
      color: "#7cb686",
    },
    {
      label: "Buckets",
      value: String(usage.totalBuckets),
      limit: null,
      icon: FolderOpen,
      color: "#7cb686",
    },
    {
      label: "Total Objects",
      value: String(usage.totalObjects),
      limit: null,
      icon: FileText,
      color: "#7cb686",
    },
    {
      label: "Egress Used",
      value: formatBytes(usage.totalEgressBytes),
      limit: `of ${egressLimitGB} GB`,
      icon: ArrowUpFromLine,
      color: "#7cb686",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Welcome back
          {session.user.name ? `, ${session.user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Here&apos;s an overview of your storage usage
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-card border border-border rounded-xl p-5 hover:border-border/50 transition-colors"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <span className="text-sm text-muted-foreground">
                  {stat.label}
                </span>
              </div>
              <p className="text-2xl font-semibold text-foreground">
                {stat.value}
              </p>
              {stat.limit && (
                <p className="text-xs text-muted-foreground/50 mt-1">
                  {stat.limit}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Usage Bars */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Storage Progress */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-foreground">
              Storage Usage
            </h3>
            <span className="text-xs text-muted-foreground">
              {storageUsedGB} / {storageLimitGB} GB
            </span>
          </div>
          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${storagePercent}%`,
                background:
                  storagePercent > 90
                    ? "hsl(var(--destructive))"
                    : storagePercent > 70
                      ? "#eab308"
                      : "hsl(var(--primary))",
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground/50 mt-2">
            {storagePercent.toFixed(1)}% used
          </p>
        </div>

        {/* Egress Progress */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-foreground">
              Egress Usage
            </h3>
            <span className="text-xs text-muted-foreground">
              {egressUsedGB} / {egressLimitGB} GB
            </span>
          </div>
          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${egressPercent}%`,
                background:
                  egressPercent > 90
                    ? "hsl(var(--destructive))"
                    : egressPercent > 70
                      ? "#eab308"
                      : "hsl(var(--primary))",
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground/50 mt-2">
            {egressPercent.toFixed(1)}% used
          </p>
        </div>
      </div>

      {/* Recent Buckets */}
      <div className="bg-card border border-border rounded-xl">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm font-medium text-foreground">
            Recent Buckets
          </h3>
        </div>
        {recentBuckets.length > 0 ? (
          <div className="divide-y divide-border">
            {recentBuckets.map((bucket) => (
              <a
                key={String(bucket._id)}
                href={`/dashboard/buckets/${String(bucket._id)}`}
                className="flex items-center justify-between px-6 py-3 hover:bg-secondary/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <FolderOpen className="w-4 h-4 text-primary/60" />
                  <span className="text-sm text-foreground">{bucket.name}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{bucket.objectCount} objects</span>
                  <span>{formatBytes(bucket.totalSizeBytes)}</span>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <FolderOpen className="w-8 h-8 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              No buckets yet. Create your first bucket to get started.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

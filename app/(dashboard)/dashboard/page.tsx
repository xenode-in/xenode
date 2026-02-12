import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import Bucket from "@/models/Bucket";
import { bytesToGB, formatBytes } from "@/lib/metering/usage";
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
  const storageLimitGB = bytesToGB(usage.storageLimitBytes);
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
        <h1 className="text-2xl font-semibold text-[#e8e4d9]">
          Welcome back
          {session.user.name ? `, ${session.user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="text-sm text-[#e8e4d9]/50 mt-1">
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
              className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl p-5 hover:border-white/10 transition-colors"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-lg bg-[#7cb686]/10">
                  <Icon className="w-4 h-4 text-[#7cb686]" />
                </div>
                <span className="text-sm text-[#e8e4d9]/50">{stat.label}</span>
              </div>
              <p className="text-2xl font-semibold text-[#e8e4d9]">
                {stat.value}
              </p>
              {stat.limit && (
                <p className="text-xs text-[#e8e4d9]/30 mt-1">{stat.limit}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Usage Bars */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Storage Progress */}
        <div className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-[#e8e4d9]">
              Storage Usage
            </h3>
            <span className="text-xs text-[#e8e4d9]/40">
              {storageUsedGB} / {storageLimitGB} GB
            </span>
          </div>
          <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${storagePercent}%`,
                background:
                  storagePercent > 90
                    ? "#ef4444"
                    : storagePercent > 70
                      ? "#eab308"
                      : "#7cb686",
              }}
            />
          </div>
          <p className="text-xs text-[#e8e4d9]/30 mt-2">
            {storagePercent.toFixed(1)}% used
          </p>
        </div>

        {/* Egress Progress */}
        <div className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-[#e8e4d9]">Egress Usage</h3>
            <span className="text-xs text-[#e8e4d9]/40">
              {egressUsedGB} / {egressLimitGB} GB
            </span>
          </div>
          <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${egressPercent}%`,
                background:
                  egressPercent > 90
                    ? "#ef4444"
                    : egressPercent > 70
                      ? "#eab308"
                      : "#7cb686",
              }}
            />
          </div>
          <p className="text-xs text-[#e8e4d9]/30 mt-2">
            {egressPercent.toFixed(1)}% used
          </p>
        </div>
      </div>

      {/* Recent Buckets */}
      <div className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl">
        <div className="px-6 py-4 border-b border-white/5">
          <h3 className="text-sm font-medium text-[#e8e4d9]">Recent Buckets</h3>
        </div>
        {recentBuckets.length > 0 ? (
          <div className="divide-y divide-white/5">
            {recentBuckets.map((bucket) => (
              <a
                key={String(bucket._id)}
                href={`/dashboard/buckets/${String(bucket._id)}`}
                className="flex items-center justify-between px-6 py-3 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <FolderOpen className="w-4 h-4 text-[#7cb686]/60" />
                  <span className="text-sm text-[#e8e4d9]">{bucket.name}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-[#e8e4d9]/40">
                  <span>{bucket.objectCount} objects</span>
                  <span>{formatBytes(bucket.totalSizeBytes)}</span>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <FolderOpen className="w-8 h-8 text-[#e8e4d9]/20 mx-auto mb-3" />
            <p className="text-sm text-[#e8e4d9]/40">
              No buckets yet. Create your first bucket to get started.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

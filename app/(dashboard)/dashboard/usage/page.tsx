import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import Bucket from "@/models/Bucket";
import { bytesToGB, formatBytes } from "@/lib/metering/usage";
import { HardDrive, ArrowUpFromLine, FolderOpen, FileText } from "lucide-react";

export default async function UsagePage() {
  const session = await requireAuth();
  const userId = session.user.id;

  await dbConnect();

  const [usage, buckets] = await Promise.all([
    Usage.findOne({ userId }).lean(),
    Bucket.find({ userId }).sort({ totalSizeBytes: -1 }).lean(),
  ]);

  const u = usage || {
    totalStorageBytes: 0,
    totalEgressBytes: 0,
    totalObjects: 0,
    totalBuckets: 0,
    storageLimitBytes: 1099511627776,
    egressLimitBytes: 536870912000,
  };

  const storageUsedGB = bytesToGB(u.totalStorageBytes);
  const storageLimitGB = bytesToGB(u.storageLimitBytes);
  const egressUsedGB = bytesToGB(u.totalEgressBytes);
  const egressLimitGB = bytesToGB(u.egressLimitBytes);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-[#e8e4d9]">Usage</h1>
        <p className="text-sm text-[#e8e4d9]/50 mt-1">
          Monitor your storage and bandwidth consumption
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <HardDrive className="w-4 h-4 text-[#7cb686]" />
            <span className="text-sm text-[#e8e4d9]/50">Storage</span>
          </div>
          <p className="text-2xl font-semibold text-[#e8e4d9]">
            {formatBytes(u.totalStorageBytes)}
          </p>
          <p className="text-xs text-[#e8e4d9]/30 mt-1">
            of {storageLimitGB} GB limit
          </p>
        </div>

        <div className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <ArrowUpFromLine className="w-4 h-4 text-[#7cb686]" />
            <span className="text-sm text-[#e8e4d9]/50">Egress</span>
          </div>
          <p className="text-2xl font-semibold text-[#e8e4d9]">
            {formatBytes(u.totalEgressBytes)}
          </p>
          <p className="text-xs text-[#e8e4d9]/30 mt-1">
            of {egressLimitGB} GB limit
          </p>
        </div>

        <div className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <FolderOpen className="w-4 h-4 text-[#7cb686]" />
            <span className="text-sm text-[#e8e4d9]/50">Buckets</span>
          </div>
          <p className="text-2xl font-semibold text-[#e8e4d9]">
            {u.totalBuckets}
          </p>
        </div>

        <div className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-[#7cb686]" />
            <span className="text-sm text-[#e8e4d9]/50">Objects</span>
          </div>
          <p className="text-2xl font-semibold text-[#e8e4d9]">
            {u.totalObjects}
          </p>
        </div>
      </div>

      {/* Detailed Progress */}
      <div className="space-y-4">
        <div className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-[#e8e4d9]">
              Storage Breakdown
            </h3>
            <span className="text-xs text-[#e8e4d9]/40">
              {storageUsedGB} / {storageLimitGB} GB
            </span>
          </div>
          <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden mb-4">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min((storageUsedGB / storageLimitGB) * 100, 100)}%`,
                background: "#7cb686",
              }}
            />
          </div>

          {/* Per-bucket breakdown */}
          {buckets.length > 0 && (
            <div className="space-y-3 pt-4 border-t border-white/5">
              {buckets.map((bucket) => {
                const bucketPercent =
                  u.totalStorageBytes > 0
                    ? (bucket.totalSizeBytes / u.totalStorageBytes) * 100
                    : 0;

                return (
                  <div key={String(bucket._id)} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#e8e4d9]/60">{bucket.name}</span>
                      <span className="text-[#e8e4d9]/40">
                        {formatBytes(bucket.totalSizeBytes)} (
                        {bucketPercent.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#7cb686]/60"
                        style={{ width: `${bucketPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-[#e8e4d9]">
              Egress (Bandwidth)
            </h3>
            <span className="text-xs text-[#e8e4d9]/40">
              {egressUsedGB} / {egressLimitGB} GB
            </span>
          </div>
          <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min((egressUsedGB / egressLimitGB) * 100, 100)}%`,
                background: "#7cb686",
              }}
            />
          </div>
          <p className="text-xs text-[#e8e4d9]/30 mt-3">
            Egress is measured by file downloads. The limit resets monthly.
          </p>
        </div>
      </div>
    </div>
  );
}

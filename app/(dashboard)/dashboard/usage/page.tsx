import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import Bucket from "@/models/Bucket";
import { bytesToGB, formatBytes } from "@/lib/utils/format";
import { HardDrive } from "lucide-react";
import { StorageChart } from "@/components/dashboard/StorageChart";

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
    storageLimitBytes: 1099511627776,
    totalBuckets: 0,
    totalObjects: 0,
  };

  const storageUsedGB = bytesToGB(u.totalStorageBytes);
  const storageLimitGB =
    u.storageLimitBytes === null ? "Unlimited" : bytesToGB(u.storageLimitBytes);

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

      {/* Storage Overview Card */}
      <div className="lg:col-span-5 xl:col-span-4 self-start">
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
          </div>
        </div>
      </div>
    </div>
  );
}

import { getAdminSession } from "@/lib/admin/session";
import { redirect, notFound } from "next/navigation";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import ShareLink from "@/models/ShareLink";
import ApiKey from "@/models/ApiKey";
import Bucket from "@/models/Bucket";
import { formatBytes, bytesToGB } from "@/lib/metering/usage";
import mongoose from "mongoose";
import {
  HardDrive,
  FileText,
  FolderOpen,
  Share2,
  Key,
  ArrowUpFromLine,
  Upload,
  Download,
} from "lucide-react";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ userId: string }> };

export default async function UserDetailPage({ params }: RouteContext) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");

  const { userId } = await params;
  await dbConnect();

  const db = mongoose.connection.db;
  if (!db) return <div>DB not connected</div>;

  const [user, usage, shareStats, apiKeys, topBuckets] = await Promise.all([
    db.collection("user").findOne({
      $or: [
        { id: userId },
        ...(mongoose.Types.ObjectId.isValid(userId)
          ? [{ _id: new mongoose.Types.ObjectId(userId) }]
          : []),
      ],
    }),
    Usage.findOne({ userId }).lean(),
    ShareLink.aggregate([
      { $match: { createdBy: userId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          totalDownloads: { $sum: "$downloadCount" },
          active: {
            $sum: { $cond: [{ $eq: ["$isRevoked", false] }, 1, 0] },
          },
        },
      },
    ]),
    ApiKey.find({ userId }).sort({ lastUsedAt: -1 }).lean(),
    Bucket.find({ userId }).sort({ totalSizeBytes: -1 }).limit(8).lean(),
  ]);

  if (!user) notFound();

  const share = shareStats[0] ?? {
    total: 0,
    totalDownloads: 0,
    active: 0,
  };
  const storageGB = bytesToGB(usage?.totalStorageBytes ?? 0);
  const storageLimitGB = bytesToGB(usage?.storageLimitBytes ?? 1099511627776);
  const storagePct =
    storageLimitGB > 0 ? Math.min((storageGB / storageLimitGB) * 100, 100) : 0;

  const plan = usage?.plan ?? "free";
  const planBadge: Record<string, string> = {
    free: "bg-secondary text-muted-foreground",
    pro: "bg-blue-500/10 text-blue-500",
    enterprise: "bg-purple-500/10 text-purple-500",
  };

  const stats = [
    {
      label: "Storage",
      value: formatBytes(usage?.totalStorageBytes ?? 0),
      icon: HardDrive,
    },
    {
      label: "Objects",
      value: (usage?.totalObjects ?? 0).toLocaleString(),
      icon: FileText,
    },
    {
      label: "Buckets",
      value: (usage?.totalBuckets ?? 0).toLocaleString(),
      icon: FolderOpen,
    },
    {
      label: "Share Links",
      value: share.total.toLocaleString(),
      icon: Share2,
    },
    {
      label: "Egress",
      value: formatBytes(usage?.totalEgressBytes ?? 0),
      icon: ArrowUpFromLine,
    },
    {
      label: "API Keys",
      value: apiKeys.length.toLocaleString(),
      icon: Key,
    },
    {
      label: "Uploads",
      value: (usage?.uploadCount ?? 0).toLocaleString(),
      icon: Upload,
    },
    {
      label: "Downloads",
      value: (usage?.downloadCount ?? 0).toLocaleString(),
      icon: Download,
    },
  ];

  return (
    <div className="space-y-6">
      {/* User Header */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-lg">
              {(user.name ?? "U")[0].toUpperCase()}
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                {user.name ?? "—"}
              </h1>
              <p className="text-sm text-muted-foreground">{user.email}</p>
              <div className="flex items-center gap-2 mt-1.5">
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${
                    planBadge[plan]
                  }`}
                >
                  {plan}
                </span>
                {usage?.planExpiresAt && (
                  <span className="text-xs text-muted-foreground">
                    expires {new Date(usage.planExpiresAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground space-y-1">
            <p>
              Joined{" "}
              {user.createdAt
                ? new Date(user.createdAt).toLocaleDateString()
                : "—"}
            </p>
            {usage?.lastActiveAt && (
              <p>
                Last active {new Date(usage.lastActiveAt).toLocaleDateString()}
              </p>
            )}
            <p
              className={
                user.emailVerified ? "text-green-500" : "text-yellow-500"
              }
            >
              {user.emailVerified ? "✓ Email verified" : "⚠ Not verified"}
            </p>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="bg-card border border-border rounded-xl p-4"
            >
              <div className="flex items-center gap-1.5 mb-2">
                <Icon className="w-3.5 h-3.5 text-primary/60" />
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <p className="text-base font-semibold text-foreground">
                {s.value}
              </p>
            </div>
          );
        })}
      </div>

      {/* Storage Bar */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-foreground">Storage Quota</h3>
          <span className="text-xs text-muted-foreground">
            {storageGB} GB / {storageLimitGB} GB
          </span>
        </div>
        <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              storagePct > 90
                ? "bg-red-500"
                : storagePct > 70
                  ? "bg-yellow-500"
                  : "bg-primary"
            }`}
            style={{ width: `${storagePct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground/60 mt-1.5">
          {storagePct.toFixed(1)}% used
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Buckets */}
        <div className="bg-card border border-border rounded-xl">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-sm font-medium text-foreground">
              Top Buckets by Size
            </h3>
          </div>
          <div className="divide-y divide-border">
            {topBuckets.length > 0 ? (
              topBuckets.map((b) => (
                <div
                  key={String(b._id)}
                  className="px-5 py-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-primary/50" />
                    <span className="text-sm text-foreground">{b.name}</span>
                  </div>
                  <div className="text-xs text-muted-foreground text-right">
                    <p>{b.objectCount.toLocaleString()} objects</p>
                    <p>{formatBytes(b.totalSizeBytes)}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                No buckets
              </div>
            )}
          </div>
        </div>

        {/* API Keys */}
        <div className="bg-card border border-border rounded-xl">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-sm font-medium text-foreground">API Keys</h3>
          </div>
          <div className="divide-y divide-border">
            {apiKeys.length > 0 ? (
              apiKeys.map((k) => (
                <div
                  key={String(k._id)}
                  className="px-5 py-3 flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm text-foreground">{k.name}</p>
                    <p className="text-xs font-mono text-muted-foreground">
                      {k.keyPrefix}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground text-right">
                    {k.lastUsedAt ? (
                      <p>Used {new Date(k.lastUsedAt).toLocaleDateString()}</p>
                    ) : (
                      <p>Never used</p>
                    )}
                    {k.expiresAt && (
                      <p>
                        Expires {new Date(k.expiresAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                No API keys
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Share Link Stats */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-medium text-foreground mb-4">
          Share Link Activity
        </h3>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-2xl font-semibold text-foreground">
              {share.total}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Total links created
            </p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-foreground">
              {share.active}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Active (not revoked)
            </p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-foreground">
              {share.totalDownloads}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Downloads via shares
            </p>
          </div>
        </div>
      </div>

      {/* Admin Actions */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-medium text-foreground mb-4">
          Admin Actions
        </h3>
        <div className="flex flex-wrap gap-3">
          <a
            href={`/admin/dashboard/logs?userId=${userId}`}
            className="text-sm px-4 py-2 border border-border rounded-lg hover:bg-secondary transition-colors"
          >
            View API Logs
          </a>
          <button
            className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            title="PATCH /api/admin/users/[userId] to change plan or limits"
          >
            Edit Plan &amp; Limits
          </button>
          <button
            className="text-sm px-4 py-2 border border-red-500/30 text-red-500 rounded-lg hover:bg-red-500/10 transition-colors"
            title="DELETE /api/admin/users/[userId] — super_admin only"
          >
            Delete User
          </button>
        </div>
      </div>
    </div>
  );
}

import { getAdminSession } from "@/lib/admin/session";
import { redirect } from "next/navigation";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import { formatBytes } from "@/lib/utils/format";
import mongoose from "mongoose";

export const dynamic = "force-dynamic";

export default async function StoragePage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");

  await dbConnect();

  const db = mongoose.connection.db;
  if (!db) return <div>DB not connected</div>;

  const topUsage = await Usage.find()
    .sort({ totalStorageBytes: -1 })
    .limit(50)
    .lean();

  const userIds = topUsage.map((u) => u.userId);
  const objectIds = userIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const userDocs = await db
    .collection("user")
    .find({ $or: [{ id: { $in: userIds } }, { _id: { $in: objectIds } }] })
    .toArray();

  const userMap = new Map(userDocs.map((u) => [u.id ?? u._id?.toString(), u]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Storage Usage
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Top 50 users by storage consumed
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                {[
                  "#",
                  "User",
                  "Plan",
                  "Storage",
                  "Usage %",
                  "Objects",
                  "Egress",
                  "Uploads",
                  "Downloads",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs text-muted-foreground font-medium"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {topUsage.map((u, i) => {
                const user = userMap.get(u.userId);
                const pct =
                  u.storageLimitBytes !== null && u.storageLimitBytes > 0
                    ? Number(
                        (
                          (u.totalStorageBytes / u.storageLimitBytes) *
                          100
                        ).toFixed(1),
                      )
                    : 0;
                return (
                  <tr key={u.userId} className="hover:bg-secondary/20">
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {i + 1}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`/admin/dashboard/users/${u.userId}`}
                        className="hover:underline"
                      >
                        <p className="text-sm font-medium text-foreground">
                          {user?.name ?? "—"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {user?.email ?? u.userId}
                        </p>
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${
                          u.plan === "pro"
                            ? "bg-blue-500/10 text-blue-500"
                            : u.plan === "enterprise"
                              ? "bg-purple-500/10 text-purple-500"
                              : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {u.plan ?? "free"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {formatBytes(u.totalStorageBytes)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              pct > 90
                                ? "bg-red-500"
                                : pct > 70
                                  ? "bg-yellow-500"
                                  : "bg-primary"
                            }`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {pct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {u.totalObjects.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatBytes(u.totalEgressBytes)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {(u.uploadCount ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {(u.downloadCount ?? 0).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
              {topUsage.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    No usage data yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

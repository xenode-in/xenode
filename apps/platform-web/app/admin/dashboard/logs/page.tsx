import { getAdminSession } from "@/lib/admin/session";
import { redirect } from "next/navigation";
import { getApiLogModel } from "@/models/ApiLog";

export const dynamic = "force-dynamic";

interface LogEntry {
  _id: unknown;
  userId: string | null;
  method: string;
  endpoint: string;
  statusCode: number;
  durationMs: number;
  errorMessage?: string;
  createdAt: Date;
}

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    userId?: string;
    endpoint?: string;
    statusCode?: string;
  }>;
}) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1"));
  const limit = 50;
  const skip = (page - 1) * limit;

  const query: Record<string, unknown> = {};
  if (sp.userId) query.userId = sp.userId;
  if (sp.endpoint) query.endpoint = { $regex: sp.endpoint, $options: "i" };
  if (sp.statusCode) query.statusCode = Number(sp.statusCode);

  const ApiLog = await getApiLogModel();
  const [logs, total] = await Promise.all([
    ApiLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean() as Promise<LogEntry[]>,
    ApiLog.countDocuments(query),
  ]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">API Logs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {total.toLocaleString()} entries &middot; auto-purge after 90 days
        </p>
      </div>

      {/* Filter bar */}
      <form method="GET" className="flex flex-wrap gap-3">
        <input
          name="endpoint"
          defaultValue={sp.endpoint ?? ""}
          placeholder="Filter by endpoint..."
          className="text-sm px-3 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary w-56"
        />
        <input
          name="userId"
          defaultValue={sp.userId ?? ""}
          placeholder="Filter by user ID..."
          className="text-sm px-3 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary w-56"
        />
        <select
          name="statusCode"
          defaultValue={sp.statusCode ?? ""}
          className="text-sm px-3 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All statuses</option>
          <option value="200">200 OK</option>
          <option value="201">201 Created</option>
          <option value="400">400 Bad Request</option>
          <option value="401">401 Unauthorized</option>
          <option value="404">404 Not Found</option>
          <option value="429">429 Rate Limited</option>
          <option value="500">500 Server Error</option>
        </select>
        <button
          type="submit"
          className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
        >
          Filter
        </button>
        <a
          href="/admin/dashboard/logs"
          className="text-sm px-4 py-2 border border-border rounded-lg hover:bg-secondary"
        >
          Clear
        </a>
      </form>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="px-4 py-3 text-left text-xs text-muted-foreground font-medium">
                  Time
                </th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground font-medium">
                  Method
                </th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground font-medium">
                  Endpoint
                </th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground font-medium">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground font-medium">
                  Duration
                </th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground font-medium">
                  User
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((log, i) => (
                <tr key={i} className="hover:bg-secondary/20">
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`font-mono text-xs font-semibold ${
                        log.method === "GET"
                          ? "text-blue-400"
                          : log.method === "POST"
                            ? "text-green-400"
                            : log.method === "DELETE"
                              ? "text-red-400"
                              : "text-yellow-400"
                      }`}
                    >
                      {log.method}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground max-w-xs truncate">
                    {log.endpoint}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        log.statusCode >= 500
                          ? "bg-red-500/10 text-red-500"
                          : log.statusCode >= 400
                            ? "bg-yellow-500/10 text-yellow-500"
                            : "bg-green-500/10 text-green-500"
                      }`}
                    >
                      {log.statusCode}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {log.durationMs}ms
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                    {log.userId ? (
                      <a
                        href={`/admin/dashboard/users/${log.userId}`}
                        className="hover:underline hover:text-foreground"
                      >
                        {log.userId.slice(0, 12)}&hellip;
                      </a>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-muted-foreground text-sm"
                  >
                    No logs found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Page {page} of {totalPages} &middot; {total.toLocaleString()}{" "}
              total
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <a
                  href={`?page=${page - 1}${
                    sp.endpoint ? `&endpoint=${sp.endpoint}` : ""
                  }${sp.userId ? `&userId=${sp.userId}` : ""}${
                    sp.statusCode ? `&statusCode=${sp.statusCode}` : ""
                  }`}
                  className="text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-secondary"
                >
                  Previous
                </a>
              )}
              {page < totalPages && (
                <a
                  href={`?page=${page + 1}${
                    sp.endpoint ? `&endpoint=${sp.endpoint}` : ""
                  }${sp.userId ? `&userId=${sp.userId}` : ""}${
                    sp.statusCode ? `&statusCode=${sp.statusCode}` : ""
                  }`}
                  className="text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-secondary"
                >
                  Next
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

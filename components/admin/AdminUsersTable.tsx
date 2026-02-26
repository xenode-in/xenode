"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { Search, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";

interface UserStorage {
  totalStorageBytes: number;
  totalEgressBytes: number;
  totalObjects: number;
  totalBuckets: number;
  storageLimitBytes: number;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  image?: string;
  createdAt: string;
  emailVerified: boolean;
  storage: UserStorage;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function AdminUsersTable() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const fetchUsers = useCallback(
    async (page: number) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          page: page.toString(),
          limit: "20",
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
        });
        const res = await fetch(`/api/admin/users?${params}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to load users");
          return;
        }
        setUsers(data.users);
        setPagination(data.pagination);
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    },
    [debouncedSearch],
  );

  useEffect(() => {
    fetchUsers(1);
  }, [fetchUsers]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Search */}
      <div className="p-4 border-b border-zinc-800">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/20"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                User
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Storage Used
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Objects
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Buckets
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Usage %
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Joined
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody key={users.length}>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-zinc-800/50">
                  {[...Array(7)].map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 bg-zinc-800 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-red-400">
                  {error}
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                  No users found
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const usagePct =
                  user.storage.storageLimitBytes > 0
                    ? Math.min(
                        100,
                        (user.storage.totalStorageBytes /
                          user.storage.storageLimitBytes) *
                          100,
                      )
                    : 0;
                const isExpanded = expandedUser === user.id;

                return (
                  <Fragment key={user.id}>
                    <tr
                      className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors cursor-pointer"
                      onClick={() =>
                        setExpandedUser(isExpanded ? null : user.id)
                      }
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-medium text-white flex-shrink-0">
                            {user.name?.charAt(0)?.toUpperCase() || "?"}
                          </div>
                          <div>
                            <p className="font-medium text-white">
                              {user.name || "—"}
                            </p>
                            <p className="text-zinc-500 text-xs">
                              {user.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-zinc-300">
                        {formatBytes(user.storage.totalStorageBytes)}
                      </td>
                      <td className="px-4 py-3 text-zinc-300">
                        {user.storage.totalObjects.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-zinc-300">
                        {user.storage.totalBuckets}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                usagePct > 80
                                  ? "bg-red-500"
                                  : usagePct > 50
                                    ? "bg-amber-500"
                                    : "bg-emerald-500"
                              }`}
                              style={{ width: `${usagePct}%` }}
                            />
                          </div>
                          <span className="text-xs text-zinc-500">
                            {usagePct.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-zinc-500 text-xs">
                        {user.createdAt
                          ? new Date(user.createdAt).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <ExternalLink className="w-3.5 h-3.5 text-zinc-600" />
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr
                        key={`${user.id}-expanded`}
                        className="bg-zinc-800/20 border-b border-zinc-800/50"
                      >
                        <td colSpan={7} className="px-4 py-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                              <p className="text-zinc-500 text-xs mb-0.5">
                                Storage Limit
                              </p>
                              <p className="text-white">
                                {formatBytes(user.storage.storageLimitBytes)}
                              </p>
                            </div>
                            <div>
                              <p className="text-zinc-500 text-xs mb-0.5">
                                Egress Used
                              </p>
                              <p className="text-white">
                                {formatBytes(user.storage.totalEgressBytes)}
                              </p>
                            </div>
                            <div>
                              <p className="text-zinc-500 text-xs mb-0.5">
                                Email Verified
                              </p>
                              <p
                                className={
                                  user.emailVerified
                                    ? "text-emerald-400"
                                    : "text-amber-400"
                                }
                              >
                                {user.emailVerified ? "Yes" : "No"}
                              </p>
                            </div>
                            <div>
                              <p className="text-zinc-500 text-xs mb-0.5">
                                User ID
                              </p>
                              <p className="text-zinc-400 font-mono text-xs">
                                {user.id}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="px-4 py-3 border-t border-zinc-800 flex items-center justify-between">
          <p className="text-xs text-zinc-500">
            {pagination.total} users &middot; page {pagination.page} of{" "}
            {pagination.totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchUsers(pagination.page - 1)}
              disabled={pagination.page <= 1 || loading}
              className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => fetchUsers(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages || loading}
              className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

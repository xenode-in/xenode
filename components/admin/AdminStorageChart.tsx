"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface UserRow {
  id: string;
  name: string;
  email: string;
  storage: {
    totalStorageBytes: number;
    totalObjects: number;
    totalBuckets: number;
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function AdminStorageChart() {
  const [data, setData] = useState<
    { name: string; storageGB: number; objects: number }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/users?limit=10&page=1")
      .then((r) => r.json())
      .then((d) => {
        const users: UserRow[] = d.users ?? [];
        const chartData = users
          .filter((u) => u.storage.totalStorageBytes > 0)
          .sort(
            (a, b) => b.storage.totalStorageBytes - a.storage.totalStorageBytes,
          )
          .slice(0, 10)
          .map((u) => ({
            name: u.name?.split(" ")[0] || u.email?.split("@")[0] || "Unknown",
            storageGB: parseFloat(
              (u.storage.totalStorageBytes / 1024 / 1024 / 1024).toFixed(3),
            ),
            objects: u.storage.totalObjects,
          }));
        setData(chartData);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
      <h2 className="text-base font-medium text-white mb-1">
        Top Users by Storage
      </h2>
      <p className="text-xs text-zinc-500 mb-6">
        Top 10 users with the most storage used
      </p>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
        </div>
      ) : data.length === 0 ? (
        <div className="h-64 flex items-center justify-center">
          <p className="text-zinc-500 text-sm">No storage data yet</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={data}
            margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="name"
              tick={{ fill: "#71717a", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#71717a", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v} GB`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#18181b",
                border: "1px solid #27272a",
                borderRadius: "8px",
                fontSize: "12px",
                color: "#fff",
              }}
              formatter={(value: number | undefined) => [
                `${value} GB`,
                "Storage",
              ]}
            />
            <Bar dataKey="storageGB" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

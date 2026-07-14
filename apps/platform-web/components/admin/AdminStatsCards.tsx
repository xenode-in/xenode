"use client";

import { useEffect, useState } from "react";
import { Users, Database, HardDrive, FolderOpen } from "lucide-react";

interface Stats {
  totalUsers: number;
  totalStorageBytes: number;
  totalEgressBytes: number;
  totalObjects: number;
  totalBuckets: number;
  actualBuckets: number;
  actualObjects: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function AdminStatsCards() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setStats(d);
      })
      .catch(() => setError("Failed to load stats"))
      .finally(() => setLoading(false));
  }, []);

  const cards = stats
    ? [
        {
          label: "Total Users",
          value: stats.totalUsers.toLocaleString(),
          icon: Users,
          color: "text-blue-400",
          bg: "bg-blue-400/10",
        },
        {
          label: "Total Storage Used",
          value: formatBytes(stats.totalStorageBytes),
          icon: HardDrive,
          color: "text-emerald-400",
          bg: "bg-emerald-400/10",
        },
        {
          label: "Total Buckets",
          value: stats.actualBuckets.toLocaleString(),
          icon: Database,
          color: "text-violet-400",
          bg: "bg-violet-400/10",
        },
        {
          label: "Total Objects",
          value: stats.actualObjects.toLocaleString(),
          icon: FolderOpen,
          color: "text-amber-400",
          bg: "bg-amber-400/10",
        },
      ]
    : [];

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 animate-pulse">
            <div className="h-4 w-24 bg-zinc-800 rounded mb-3" />
            <div className="h-8 w-32 bg-zinc-800 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-zinc-400">{card.label}</p>
              <div className={`p-2 rounded-lg ${card.bg}`}>
                <Icon className={`w-4 h-4 ${card.color}`} />
              </div>
            </div>
            <p className="text-2xl font-semibold text-white">{card.value}</p>
          </div>
        );
      })}
    </div>
  );
}

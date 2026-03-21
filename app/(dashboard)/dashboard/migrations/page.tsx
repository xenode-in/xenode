"use client";

import { useState, useEffect } from "react";
import {
  CloudDownload,
  Plus,
  HardDrive,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils/format";

import { StartMigrationDialog } from "@/components/dashboard/migrations/StartMigrationDialog";

type MigrationStatus =
  | "CREATED"
  | "SCANNING"
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

interface MigrationJob {
  _id: string;
  provider: string;
  status: MigrationStatus;
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
  totalBytes: number;
  migratedBytes: number;
  createdAt: string;
}

export default function MigrationsPage() {
  const [migrations, setMigrations] = useState<MigrationJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const fetchMigrations = async () => {
    try {
      const res = await fetch("/api/migrations");
      if (res.ok) {
        const data = await res.json();
        setMigrations(data);
      }
    } catch (error) {
      console.error("Failed to fetch migrations", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMigrations();

    // Poll every 5 seconds if there are active migrations
    const hasActive = migrations.some((m) =>
      ["CREATED", "SCANNING", "QUEUED", "PROCESSING"].includes(m.status),
    );

    if (hasActive) {
      const interval = setInterval(fetchMigrations, 5000);
      return () => clearInterval(interval);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMigrationCreated = () => {
    fetchMigrations();
    setIsDialogOpen(false);
  };

  const getStatusColor = (status: MigrationStatus) => {
    switch (status) {
      case "COMPLETED":
        return "text-emerald-500 bg-emerald-500/10";
      case "FAILED":
        return "text-red-500 bg-red-500/10";
      case "CANCELLED":
        return "text-zinc-500 bg-zinc-500/10";
      default:
        return "text-blue-500 bg-blue-500/10";
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Migrations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Import files using Google Takeout ZIP.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            New Migration
          </Button>
        </div>
      </div>

      <StartMigrationDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onSuccess={handleMigrationCreated}
      />

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex justify-between items-center">
          <h3 className="text-sm font-medium text-foreground">
            Migration History
          </h3>
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchMigrations}
            disabled={isLoading}
          >
            <RefreshCw
              className={`w-4 h-4 text-muted-foreground ${isLoading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>

        {isLoading && migrations.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            Loading...
          </div>
        ) : migrations.length > 0 ? (
          <div className="divide-y divide-border">
            {migrations.map((migration) => {
              const progress =
                migration.totalBytes > 0
                  ? Math.min(
                      (migration.migratedBytes / migration.totalBytes) * 100,
                      100,
                    )
                  : 0;

              return (
                <div key={migration._id} className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <HardDrive className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h4 className="font-medium text-foreground">
                          {migration.provider.replace("_", " ")} Import
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          {new Date(migration.createdAt).toLocaleDateString()}{" "}
                          at{" "}
                          {new Date(migration.createdAt).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${getStatusColor(migration.status)}`}
                    >
                      {migration.status}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {migration.processedFiles} / {migration.totalFiles}{" "}
                        files
                        {migration.failedFiles > 0 && (
                          <span className="text-red-500 ml-2">
                            ({migration.failedFiles} failed)
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground font-mono">
                        {formatBytes(migration.migratedBytes)} /{" "}
                        {formatBytes(migration.totalBytes)}
                      </span>
                    </div>

                    <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500 ease-in-out"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <CloudDownload className="w-8 h-8 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm text-foreground font-medium">
              No migrations yet
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Start by importing your files via a ZIP.
            </p>
            <Button
              variant="outline"
              className="mt-4 gap-2"
              onClick={() => setIsDialogOpen(true)}
            >
              <Plus className="w-4 h-4" />
              Start Import
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

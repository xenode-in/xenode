"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, FolderOpen, Loader2, ExternalLink } from "lucide-react";
import Link from "next/link";

interface BucketData {
  _id: string;
  name: string;
  objectCount: number;
  totalSizeBytes: number;
  region: string;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function BucketsPage() {
  const [buckets, setBuckets] = useState<BucketData[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [newBucketName, setNewBucketName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const fetchBuckets = useCallback(async () => {
    try {
      const res = await fetch("/api/buckets");
      const data = await res.json();
      if (data.buckets) {
        setBuckets(data.buckets);
      }
    } catch {
      setError("Failed to load buckets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBuckets();
  }, [fetchBuckets]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError("");

    try {
      const res = await fetch("/api/buckets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newBucketName }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create bucket");
        return;
      }

      setNewBucketName("");
      setCreateOpen(false);
      fetchBuckets();
    } catch {
      setError("Failed to create bucket");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    setError("");

    try {
      const res = await fetch(`/api/buckets/${deleteId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to delete bucket");
        return;
      }

      setDeleteId(null);
      fetchBuckets();
    } catch {
      setError("Failed to delete bucket");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#e8e4d9]">Buckets</h1>
          <p className="text-sm text-[#e8e4d9]/50 mt-1">
            Manage your storage buckets
          </p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#7cb686] text-[#0f1a12] hover:bg-[#6ba876] font-medium">
              <Plus className="w-4 h-4 mr-2" />
              Create Bucket
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-[#1a2e1d] border-white/10 text-[#e8e4d9]">
            <DialogHeader>
              <DialogTitle>Create New Bucket</DialogTitle>
              <DialogDescription className="text-[#e8e4d9]/50">
                Bucket names must be 3-63 characters, lowercase, and can contain
                letters, numbers, and hyphens.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate}>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="bucket-name" className="text-[#e8e4d9]/80">
                    Bucket Name
                  </Label>
                  <Input
                    id="bucket-name"
                    value={newBucketName}
                    onChange={(e) => setNewBucketName(e.target.value)}
                    placeholder="my-bucket-name"
                    className="bg-white/5 border-white/10 text-[#e8e4d9] placeholder:text-[#e8e4d9]/30 focus-visible:ring-[#7cb686]/50"
                    required
                    minLength={3}
                    maxLength={63}
                    pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
                  />
                </div>
                {error && <p className="text-sm text-red-400">{error}</p>}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setCreateOpen(false)}
                  className="text-[#e8e4d9]/60 hover:text-[#e8e4d9] hover:bg-white/5"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={creating}
                  className="bg-[#7cb686] text-[#0f1a12] hover:bg-[#6ba876]"
                >
                  {creating ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : null}
                  Create Bucket
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {error && !createOpen && !deleteId && (
        <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {/* Buckets Table */}
      <div className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-[#7cb686]" />
          </div>
        ) : buckets.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="border-white/5 hover:bg-transparent">
                <TableHead className="text-[#e8e4d9]/50">Name</TableHead>
                <TableHead className="text-[#e8e4d9]/50">Objects</TableHead>
                <TableHead className="text-[#e8e4d9]/50">Size</TableHead>
                <TableHead className="text-[#e8e4d9]/50">Region</TableHead>
                <TableHead className="text-[#e8e4d9]/50">Created</TableHead>
                <TableHead className="text-[#e8e4d9]/50 text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {buckets.map((bucket) => (
                <TableRow
                  key={bucket._id}
                  className="border-white/5 hover:bg-white/5"
                >
                  <TableCell>
                    <Link
                      href={`/dashboard/buckets/${bucket._id}`}
                      className="flex items-center gap-2 text-[#e8e4d9] hover:text-[#7cb686] transition-colors"
                    >
                      <FolderOpen className="w-4 h-4 text-[#7cb686]/60" />
                      {bucket.name}
                      <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                    </Link>
                  </TableCell>
                  <TableCell className="text-[#e8e4d9]/60">
                    {bucket.objectCount}
                  </TableCell>
                  <TableCell className="text-[#e8e4d9]/60">
                    {formatBytes(bucket.totalSizeBytes)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className="bg-white/5 text-[#e8e4d9]/60 border-0"
                    >
                      {bucket.region}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[#e8e4d9]/40 text-sm">
                    {formatDate(bucket.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteId(bucket._id)}
                      className="text-[#e8e4d9]/40 hover:text-red-400 hover:bg-red-400/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 px-4">
            <FolderOpen className="w-12 h-12 text-[#e8e4d9]/10 mb-4" />
            <p className="text-[#e8e4d9]/40 text-sm mb-4">
              No buckets yet. Create your first bucket to start storing files.
            </p>
            <Button
              onClick={() => setCreateOpen(true)}
              className="bg-[#7cb686] text-[#0f1a12] hover:bg-[#6ba876]"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Bucket
            </Button>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <DialogContent className="bg-[#1a2e1d] border-white/10 text-[#e8e4d9]">
          <DialogHeader>
            <DialogTitle>Delete Bucket</DialogTitle>
            <DialogDescription className="text-[#e8e4d9]/50">
              This will permanently delete the bucket and all its objects. This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteId(null)}
              className="text-[#e8e4d9]/60 hover:text-[#e8e4d9] hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {deleting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Delete Bucket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

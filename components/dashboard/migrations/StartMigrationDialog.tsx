"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Folder } from "lucide-react";

interface StartMigrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function StartMigrationDialog({
  open,
  onOpenChange,
  onSuccess,
}: StartMigrationDialogProps) {
  const [provider, setProvider] = useState<string>("GOOGLE_DRIVE");
  const [destinationBucketId, setDestinationBucketId] = useState<string>("");
  const [destinationPath, setDestinationPath] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [availableFolders, setAvailableFolders] = useState<any[]>([]);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [accounts, setAccounts] = useState<any[]>([]);

  const fetchAccounts = async () => {
    try {
      const res = await fetch("/api/auth/accounts");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (open) {
      fetchConfig();
      fetchAccounts();
    } else {
      setSelectedFolders([]);
      setAvailableFolders([]);
      setError(null);
    }
  }, [open]);

  const hasGoogleAccount = accounts.some((acc) => acc.providerId === "google");
  const googleAccountId = accounts.find(
    (acc) => acc.providerId === "google",
  )?.accountId;

  useEffect(() => {
    if (googleAccountId && open) {
      fetchDriveFolders(googleAccountId);
    }
  }, [googleAccountId, open]);

  const fetchDriveFolders = async (accountId: string) => {
    setIsLoadingFolders(true);
    try {
      const res = await fetch(`/api/migrations/providers/google/folders?accountId=${accountId}`);
      if (res.ok) {
        const data = await res.json();
        setAvailableFolders(data || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingFolders(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/drive/config");
      if (res.ok) {
        const data = await res.json();
        if (data.bucket) {
          setDestinationBucketId(data.bucket._id);
          setDestinationPath(data.rootPrefix || "");
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const toggleFolder = (folderId: string) => {
    setSelectedFolders((prev) => 
      prev.includes(folderId) 
        ? prev.filter((id) => id !== folderId)
        : [...prev, folderId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    if (!hasGoogleAccount || !googleAccountId) {
      setError("Please connect your Google account in Settings first.");
      setIsLoading(false);
      return;
    }

    if (!destinationBucketId) {
      setError("Please select a destination bucket.");
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/migrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          providerAccountId: googleAccountId,
          destinationBucketId,
          destinationPath: destinationPath
            ? `${destinationPath}migrations/`
            : "migrations/",
          sourceFolderId: selectedFolders.length > 0 ? selectedFolders.join(",") : "root",
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start migration");
      }

      onSuccess();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start migration",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Start Migration</DialogTitle>
          <DialogDescription>
            Import files from your external cloud provider into Xenode.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Provider</label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue placeholder="Select Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GOOGLE_DRIVE">Google Drive</SelectItem>
                <SelectItem value="ONEDRIVE" disabled>
                  OneDrive (Coming Soon)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Destination</label>
            <div className="p-3 bg-secondary rounded-md text-sm text-foreground flex items-center gap-2 border border-border">
              <span className="font-semibold">Xenode Drive</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-muted-foreground">
                {destinationPath
                  ? `${destinationPath}migrations`
                  : "migrations"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Files will be imported directly into your Xenode drive.
            </p>
          </div>

          {hasGoogleAccount && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Select Folders</label>
                <span className="text-xs text-muted-foreground">
                  {selectedFolders.length === 0 ? "Everything" : `${selectedFolders.length} selected`}
                </span>
              </div>
              <div className="h-48 overflow-y-auto border border-border rounded-md bg-secondary/50">
                {isLoadingFolders ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    <span className="text-sm">Loading folders...</span>
                  </div>
                ) : availableFolders.length > 0 ? (
                  <div className="p-2 space-y-1">
                    {availableFolders.map((folder) => (
                      <div
                        key={folder.id}
                        className="flex items-center gap-3 p-2 rounded-md hover:bg-secondary transition-colors cursor-pointer"
                        onClick={() => toggleFolder(folder.id)}
                      >
                        <input
                          type="checkbox"
                          checked={selectedFolders.includes(folder.id)}
                          readOnly
                          className="w-4 h-4 pointer-events-none accent-primary"
                        />
                        <Folder className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm flex-1 truncate">{folder.name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    No folders found in your drive.
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                If no folders are selected, your entire drive will be migrated.
              </p>
            </div>
          )}

          {!hasGoogleAccount && (
            <div className="p-3 bg-yellow-500/10 text-yellow-500 text-sm rounded-md border border-yellow-500/20">
              You haven&apos;t linked a Google account. Please link one in
              Settings before migrating.
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-500/10 text-red-500 text-sm rounded-md border border-red-500/20">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !hasGoogleAccount || !destinationBucketId}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                "Start Import"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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
import { Loader2, Folder, FileIcon, ChevronLeft } from "lucide-react";

interface StartMigrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  hasGoogleAccount: boolean;
  googleAccountId?: string;
  onReconnect?: () => void;
}

export function StartMigrationDialog({
  open,
  onOpenChange,
  onSuccess,
  hasGoogleAccount,
  googleAccountId,
  onReconnect,
}: StartMigrationDialogProps) {
  const [provider, setProvider] = useState<string>("GOOGLE_DRIVE");
  const [destinationBucketId, setDestinationBucketId] = useState<string>("");
  const [destinationPath, setDestinationPath] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [availableFolders, setAvailableFolders] = useState<any[]>([]);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);

  const [currentFolderId, setCurrentFolderId] = useState<string>("root");
  const [folderHistory, setFolderHistory] = useState<
    { id: string; name: string }[]
  >([]);

  useEffect(() => {
    if (open) {
      fetchConfig();
    } else {
      setSelectedFolders([]);
      setAvailableFolders([]);
      setCurrentFolderId("root");
      setFolderHistory([]);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (googleAccountId && open) {
      fetchDriveFolders(googleAccountId, currentFolderId);
    }
  }, [googleAccountId, open, currentFolderId]);

  const fetchDriveFolders = async (accountId: string, folderId: string) => {
    setIsLoadingFolders(true);
    try {
      const res = await fetch(
        `/api/migrations/providers/google/folders?accountId=${accountId}&folderId=${folderId}`,
      );
      if (res.ok) {
        const data = await res.json();
        const folders = data || [];
        setAvailableFolders(folders);

        const folderIds = folders.map((f: any) => f.id);
        setSelectedFolders((prev) => {
          const newSelection = new Set([...prev, ...folderIds]);
          return Array.from(newSelection);
        });
      } else if (res.status === 401 || res.status === 500) {
        setError("Google session expired. Please reconnect your account. (Important: Login with same email id)");
      } else {
        setError("Failed to fetch folders. Please try again.");
      }
    } catch (err) {
      console.error(err);
      setError("An unexpected error occurred while fetching folders.");
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

  const navigateToFolder = (folderId: string, folderName: string) => {
    setFolderHistory((prev) => [...prev, { id: folderId, name: folderName }]);
    setCurrentFolderId(folderId);
  };

  const navigateUp = () => {
    setFolderHistory((prev) => {
      const newHistory = [...prev];
      newHistory.pop();
      const last =
        newHistory.length > 0 ? newHistory[newHistory.length - 1].id : "root";
      setCurrentFolderId(last);
      return newHistory;
    });
  };

  const toggleFolder = (folderId: string) => {
    setSelectedFolders((prev) =>
      prev.includes(folderId)
        ? prev.filter((id) => id !== folderId)
        : [...prev, folderId],
    );
  };

  const allIds = availableFolders.map((f) => f.id);
  const areAllSelected =
    availableFolders.length > 0 &&
    allIds.every((id) => selectedFolders.includes(id));

  const selectAllFolders = () => {
    if (areAllSelected) {
      setSelectedFolders((prev) => prev.filter((id) => !allIds.includes(id)));
    } else {
      setSelectedFolders((prev) => {
        const newSet = new Set([...prev, ...allIds]);
        return Array.from(newSet);
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    if (!hasGoogleAccount || !googleAccountId) {
      setError("Please connect Google account first.");
      setIsLoading(false);
      return;
    }

    if (!destinationBucketId) {
      setError("Destination not configured.");
      setIsLoading(false);
      return;
    }

    if (selectedFolders.length === 0) {
      setError("Select at least one item.");
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
          sourceFolderId: selectedFolders.join(","),
        }),
      });

      if (!res.ok) throw new Error("Failed");

      onSuccess();
      onOpenChange(false);
    } catch (err) {
      setError("Failed to start migration");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-lg sm:max-w-xl rounded-xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg">
            Start Migration
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Import files from external providers into Xenode.
          </DialogDescription>
        </DialogHeader>

        {/* Content */}
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 overflow-y-auto pr-1"
        >
          {/* Provider */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Provider</label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GOOGLE_DRIVE">Google Drive</SelectItem>
                <SelectItem value="ONEDRIVE" disabled>
                  OneDrive
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Destination */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Destination</label>
            <div className="p-3 bg-secondary rounded-md text-xs sm:text-sm">
              <span className="font-semibold">Xenode</span> /{" "}
              {destinationPath || "migrations"}
            </div>
          </div>

          {/* File Picker */}
          {hasGoogleAccount && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Select Items</span>
                <span>{selectedFolders.length}</span>
              </div>

              <div className="border rounded-md flex flex-col">
                {/* Nav */}
                <div className="flex items-center gap-2 p-2 border-b">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={navigateUp}
                    disabled={currentFolderId === "root"}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>

                  <span className="text-xs flex-1 truncate">
                    {currentFolderId === "root"
                      ? "My Drive"
                      : folderHistory.at(-1)?.name}
                  </span>

                  <Button size="sm" variant="ghost" onClick={selectAllFolders}>
                    {areAllSelected ? "Clear" : "All"}
                  </Button>
                </div>

                {/* List */}
                <div className="max-h-60 sm:max-h-72 overflow-y-auto p-2 space-y-1">
                  {isLoadingFolders ? (
                    <div className="flex justify-center py-6 text-sm">
                      <Loader2 className="animate-spin mr-2" /> Loading
                    </div>
                  ) : availableFolders.length > 0 ? (
                    availableFolders.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center gap-3 p-2 rounded-md hover:bg-muted cursor-pointer"
                        onClick={() => toggleFolder(f.id)}
                        onDoubleClick={() =>
                          f.isFolder && navigateToFolder(f.id, f.name)
                        }
                      >
                        <input
                          type="checkbox"
                          checked={selectedFolders.includes(f.id)}
                          readOnly
                        />
                        {f.isFolder ? (
                          <Folder className="w-4 h-4 text-primary" />
                        ) : (
                          <FileIcon className="w-4 h-4" />
                        )}
                        <span className="text-sm truncate">{f.name}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-xs py-6">Empty folder</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-red-500 text-sm bg-red-100 p-3 rounded flex flex-col gap-2">
              <span>{error}</span>
              {error.includes("session expired") && onReconnect && (
                <Button 
                  type="button" 
                  variant="destructive" 
                  size="sm" 
                  onClick={onReconnect}
                  className="w-fit"
                >
                  Reconnect Google
                </Button>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex flex-col sm:flex-row gap-2 justify-end pt-2 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full sm:w-auto"
            >
              {isLoading ? "Starting..." : "Start Import"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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
import { authClient } from "@/lib/auth/client";
import { Loader2, Folder, FileIcon, ChevronLeft, CloudDownload } from "lucide-react";

interface StartMigrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  hasGoogleAccount: boolean;
  googleAccountId?: string;
}

export function StartMigrationDialog({
  open,
  onOpenChange,
  onSuccess,
  hasGoogleAccount,
  googleAccountId
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

  const [currentFolderId, setCurrentFolderId] = useState<string>("root");
  const [folderHistory, setFolderHistory] = useState<
    { id: string; name: string }[]
  >([]);

  useEffect(() => {
    if (open) {
      fetchConfig();
      // fetchAccounts(); // Removing local account fetch
    } else {
      setSelectedFolders([]);
      setAvailableFolders([]);
      setCurrentFolderId("root");
      setFolderHistory([]);
      setError(null);
    }
  }, [open]);

  // Using props instead of local state for accounts
  // const hasGoogleAccount = accounts.some((acc) => acc.providerId === "google");
  // const googleAccountId = accounts.find(
  //   (acc) => acc.providerId === "google",
  // )?.accountId;

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
        
        // Auto-select all items when entering a folder (or root) for the first time
        // if they aren't already explicitly selected/deselected
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const folderIds = folders.map((f: any) => f.id);
        setSelectedFolders((prev) => {
          // Combine existing selections with the new folder items
          const newSelection = new Set([...prev, ...folderIds]);
          return Array.from(newSelection);
        });
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

  const navigateToFolder = (folderId: string, folderName: string) => {
    setFolderHistory((prev) => [...prev, { id: folderId, name: folderName }]);
    setCurrentFolderId(folderId);
  };

  const navigateUp = () => {
    setFolderHistory((prev) => {
      const newHistory = [...prev];
      newHistory.pop();
      const lastFolder =
        newHistory.length > 0 ? newHistory[newHistory.length - 1].id : "root";
      setCurrentFolderId(lastFolder);
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
  // However, "Select All" should toggle all items IN THE CURRENT VIEW.
  const allIds = availableFolders.map((f) => f.id);
  const areAllSelected =
    availableFolders.length > 0 && allIds.every((id) => selectedFolders.includes(id));

  const selectAllFolders = () => {
    if (areAllSelected) {
      // Deselect all current view
      setSelectedFolders((prev) => prev.filter((id) => !allIds.includes(id)));
    } else {
      // Select all current view
      setSelectedFolders((prev) => {
        const newSelection = new Set([...prev, ...allIds]);
        return Array.from(newSelection);
      });
    }
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

    if (selectedFolders.length === 0) {
      setError("Please select at least one item to migrate.");
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
          sourceFolderId:
            selectedFolders.length > 0 ? selectedFolders.join(",") : "none",
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
                <label className="text-sm font-medium">Select Items</label>
                <span className="text-xs text-muted-foreground">
                  {selectedFolders.length} selected
                </span>
              </div>
              <div className="flex flex-col border border-border rounded-md bg-secondary/50">
                {/* Navigation Header */}
                <div className="flex items-center gap-2 p-2 border-b border-border bg-muted/20">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    disabled={currentFolderId === "root"}
                    onClick={navigateUp}
                    type="button"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs font-medium truncate flex-1">
                    {currentFolderId === "root"
                      ? "My Drive"
                      : folderHistory[folderHistory.length - 1]?.name}
                  </span>
                  {availableFolders.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs px-2 cursor-pointer"
                      onClick={selectAllFolders}
                      type="button"
                    >
                      {areAllSelected ? "Deselect All" : "Select All"}
                    </Button>
                  )}
                </div>

                <div className="h-48 overflow-y-auto p-2">
                  {isLoadingFolders ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      <span className="text-sm">Loading files...</span>
                    </div>
                  ) : availableFolders.length > 0 ? (
                    <div className="space-y-1">
                      {availableFolders.map((folder) => (
                        <div
                          key={folder.id}
                          className="flex items-center gap-3 p-2 rounded-md hover:bg-secondary transition-colors cursor-pointer"
                          onDoubleClick={() => {
                            if (folder.isFolder) {
                              navigateToFolder(folder.id, folder.name);
                            }
                          }}
                          onClick={() => toggleFolder(folder.id)}
                        >
                          <input
                            type="checkbox"
                            checked={selectedFolders.includes(folder.id)}
                            readOnly
                            className="w-4 h-4 pointer-events-none accent-primary"
                          />
                          {folder.isFolder ? (
                            <Folder className="w-4 h-4 text-muted-foreground shrink-0 fill-primary/20 text-primary" />
                          ) : (
                            <FileIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="text-sm flex-1 truncate">
                            {folder.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                      This folder is empty.
                    </div>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Only the items checked above will be imported.
              </p>
            </div>
          )}

          {!hasGoogleAccount && (
            <div className="p-4 bg-secondary/50 rounded-lg border border-border flex flex-col items-center text-center space-y-3">
              <div className="p-2 rounded-full bg-primary/10">
                <CloudDownload className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Connect Google Drive
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">
                  Link your Google account to authorize Xenode to read and import your files.
                </p>
              </div>
              <Button
                type="button"
                className="w-full mt-2"
                onClick={async () => {
                  await authClient.linkSocial({
                    provider: "google",
                    callbackURL: "/dashboard/migrations",
                    errorCallbackURL: "/dashboard/migrations",
                  });
                }}
              >
                Connect Account
              </Button>
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

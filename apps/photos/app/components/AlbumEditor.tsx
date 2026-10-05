"use client";

import { useState } from "react";
import { FolderPlus, Loader2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@xenode/ui";
import { sealAlbumName } from "@/lib/album-name";
import { usePhotosMetadataKey } from "./PhotosKeyAccess";

export function AlbumEditor({
  spaceId,
  accountId,
  selectedIds,
  onCreated,
}: {
  spaceId: string;
  accountId: string;
  selectedIds: string[];
  onCreated(): void;
}) {
  const metadataKey = usePhotosMetadataKey(spaceId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!metadataKey) {
      setStatus("Unlock Photos to create an album.");
      return;
    }
    setSaving(true);
    setStatus("");
    try {
      // Only the sealed envelope leaves the browser, never the title.
      const encryptedName = await sealAlbumName(name.trim(), metadataKey, accountId, spaceId);
      const response = await fetch(
        `/api/photos/albums?spaceId=${encodeURIComponent(spaceId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            encryptedName,
            photoAssetIds: selectedIds,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setStatus(
        response.ok ? "Album created." : payload.error ?? "Album failed.",
      );
      if (response.ok) {
        setName("");
        setOpen(false);
        onCreated();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="rounded-full"
        onClick={() => setOpen(true)}
      >
        <FolderPlus className="size-4" />
        Add to album
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create encrypted album</DialogTitle>
            <DialogDescription>
              Organize {selectedIds.length} selected{" "}
              {selectedIds.length === 1 ? "photo" : "photos"} without moving
              the encrypted originals.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Album name"
            placeholder="Album name"
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {status ? (
            <p role="status" className="text-xs text-muted-foreground">
              {status}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                saving || !name.trim() || !metadataKey || selectedIds.length === 0
              }
              onClick={() => void create()}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Create album
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

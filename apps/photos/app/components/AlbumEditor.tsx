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

export function AlbumEditor({
  spaceId,
  selectedIds,
  onCreated,
}: {
  spaceId: string;
  selectedIds: string[];
  onCreated(): void;
}) {
  const [open, setOpen] = useState(false);
  const [encryptedName, setEncryptedName] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    setSaving(true);
    setStatus("");
    try {
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
        setEncryptedName("");
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
            aria-label="Encrypted album name envelope"
            placeholder="Encrypted name envelope"
            value={encryptedName}
            onChange={(event) => setEncryptedName(event.target.value)}
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
                saving || encryptedName.length < 16 || selectedIds.length === 0
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

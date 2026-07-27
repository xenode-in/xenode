"use client";

import { useState } from "react";
import { LockKeyhole, Share2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@xenode/ui";

export function ShareDialog({ selectedIds }: { selectedIds: string[] }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"viewer" | "commenter" | "editor">(
    "viewer",
  );
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="rounded-full"
        disabled={!selectedIds.length}
        onClick={() => setOpen(true)}
      >
        <Share2 className="size-4" />
        Share {selectedIds.length}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share selected photos</DialogTitle>
            <DialogDescription>
              Configure access for {selectedIds.length} encrypted{" "}
              {selectedIds.length === 1 ? "asset" : "assets"}.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-primary/10 bg-primary/[0.04] p-4">
            <div className="flex items-start gap-3">
              <LockKeyhole className="mt-0.5 size-4 text-primary" />
              <p className="text-xs leading-5 text-muted-foreground">
                The server enforces the selected role. Photo keys remain
                protected by the encrypted sharing flow.
              </p>
            </div>
          </div>
          <Select
            value={role}
            onValueChange={(value) => setRole(value as typeof role)}
          >
            <SelectTrigger aria-label="Share access role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="viewer">Viewer</SelectItem>
              <SelectItem value="commenter">Commenter</SelectItem>
              <SelectItem value="editor">Editor</SelectItem>
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Continue as {role}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

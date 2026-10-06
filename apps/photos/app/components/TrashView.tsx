"use client";

import { useMemo, useState } from "react";
import { Loader2, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from "@xenode/ui";
import { PhotoGrid } from "./PhotoGrid";
import { usePhotoSelection } from "./SelectionController";
import { changePhotoAssets, usePhotoPages } from "./usePhotoPages";

/** Trashed photos keep their quota until restored or permanently deleted. */
export function TrashView({ spaceId }: { spaceId: string }) {
  const selection = usePhotoSelection();
  const { items, setItems, cursor, loaded, loading, error, load, loadMore } =
    usePhotoPages(`/api/photos/trash?spaceId=${encodeURIComponent(spaceId)}`);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const groups = useMemo(
    () => [{ label: "", shortLabel: "", assets: items }],
    [items],
  );
  const selected = items
    .filter((item) => selection.selected.has(item.id))
    .map((item) => item.id);

  async function apply(action: "restore" | "purge") {
    setBusy(true);
    try {
      const { done, error: failure } = await changePhotoAssets(
        action,
        spaceId,
        selected,
      );
      const removed = new Set(done);
      setItems((current) => current.filter((item) => !removed.has(item.id)));
      for (const id of done) selection.toggle(id);
      if (done.length) {
        toast.success(
          action === "restore"
            ? `Restored ${done.length} ${done.length === 1 ? "item" : "items"}`
            : `Deleting ${done.length} ${done.length === 1 ? "item" : "items"} permanently`,
        );
      }
      if (failure) toast.error(failure);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-4">
        <p className="text-sm text-muted-foreground">
          Items in trash still count toward storage and are deleted permanently
          after 30 days.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="rounded-full"
            disabled={!selected.length || busy}
            onClick={() => void apply("restore")}
          >
            <RotateCcw className="size-4" />
            Restore
          </Button>
          <Button
            variant="destructive"
            className="rounded-full"
            disabled={!selected.length || busy}
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-4" />
            Delete forever
          </Button>
        </div>
      </div>

      {!loaded ? (
        <div className="grid min-h-[45vh] place-items-center">
          <Loader2 className="size-7 animate-spin text-primary" />
        </div>
      ) : error && !items.length ? (
        <div className="grid min-h-[45vh] place-items-center text-center">
          <div>
            <p className="font-medium">{error}</p>
            <Button
              variant="outline"
              className="mt-4 rounded-full"
              onClick={() => void load(null)}
            >
              <RefreshCw className="size-4" />
              Try again
            </Button>
          </div>
        </div>
      ) : !items.length ? (
        <div className="grid min-h-[45vh] place-items-center rounded-3xl border border-dashed border-border text-center">
          <div>
            <Trash2 className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 font-medium">Trash is empty</p>
          </div>
        </div>
      ) : (
        <>
          <PhotoGrid
            groups={groups}
            density="compact"
            onOpen={(asset) => selection.toggle(asset.id)}
            onEndReached={loadMore}
          />
          {loading ? (
            <div className="flex justify-center pb-8 pt-2">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : error && cursor ? (
            <div className="flex justify-center pb-8 pt-2">
              <Button
                variant="outline"
                className="rounded-full px-6"
                onClick={() => void load(cursor)}
              >
                <RefreshCw className="size-4" />
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selected.length} permanently?</DialogTitle>
            <DialogDescription>
              The encrypted originals and previews are erased from storage. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void apply("purge")}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

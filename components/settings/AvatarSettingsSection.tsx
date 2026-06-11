"use client";

import { useState, useCallback, useRef } from "react";
import { authClient, useSession } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, Upload, ImageIcon } from "lucide-react";
import { toast } from "sonner";

// ─── helpers ────────────────────────────────────────────────────────────────

async function fetchRandomAvatars(): Promise<string[]> {
  const res = await fetch("/api/avatars");
  const data = await res.json();
  return data.avatars ?? [];
}

async function uploadCustomAvatar(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/user/avatar", { method: "POST", body: formData });
  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  return data.url as string;
}

// ─── component ──────────────────────────────────────────────────────────────

export function AvatarSettingsSection() {
  const { data: session, refetch } = useSession();
  const currentImage = session?.user?.image;

  const [open, setOpen] = useState(false);

  // avatar grid
  const [avatars, setAvatars] = useState<string[]>([]);
  const [loadingAvatars, setLoadingAvatars] = useState(false);
  const [selected, setSelected] = useState<string>("");

  // custom upload
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [customPreview, setCustomPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // saving
  const [saving, setSaving] = useState(false);

  // ── fetch random avatars ──────────────────────────────────────────────────
  const loadAvatars = useCallback(async () => {
    setLoadingAvatars(true);
    try {
      const list = await fetchRandomAvatars();
      setAvatars(list);
      // auto-select first only if nothing selected yet
      setSelected((prev) => (prev ? prev : list[0] ?? ""));
    } catch {
      toast.error("Failed to load avatars");
    } finally {
      setLoadingAvatars(false);
    }
  }, []);

  // ── open dialog ───────────────────────────────────────────────────────────
  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen && avatars.length === 0) {
      // pre-select current image if it matches a grid url, else leave blank
      setSelected(currentImage ?? "");
      loadAvatars();
    }
    if (!isOpen) {
      // reset custom state on close
      setCustomFile(null);
      setCustomPreview(null);
    }
  };

  // ── custom file pick ──────────────────────────────────────────────────────
  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCustomFile(file);
    setCustomPreview(URL.createObjectURL(file));
    setSelected("custom");
  };

  // ── save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      let finalUrl = selected;

      if (selected === "custom") {
        if (!customFile) {
          toast.error("Please select an image to upload.");
          return;
        }
        finalUrl = await uploadCustomAvatar(customFile);
      }

      const { error } = await authClient.updateUser({ image: finalUrl });
      if (error) throw new Error(error.message);

      toast.success("Avatar updated!");
      await refetch();
      setOpen(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to update avatar");
    } finally {
      setSaving(false);
    }
  };

  // ─── render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex items-center justify-between py-3 border-b border-border">
      <div className="flex items-center gap-3">
        {/* current avatar preview */}
        <div className="w-10 h-10 rounded-full overflow-hidden border border-border bg-muted flex items-center justify-center shrink-0">
          {currentImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentImage} alt="Current avatar" className="w-full h-full object-cover" />
          ) : (
            <ImageIcon className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
        <div>
          <p className="text-sm text-foreground">Avatar</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {currentImage ? "Click to change your profile picture" : "No avatar set"}
          </p>
        </div>
      </div>

      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            Change Avatar
          </Button>
        </DialogTrigger>

        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose an Avatar</DialogTitle>
          </DialogHeader>

          {/* header: label + randomize */}
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Random picks
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={loadAvatars}
              disabled={loadingAvatars}
              className="h-8 px-3 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingAvatars ? "animate-spin" : ""}`} />
              Randomize
            </Button>
          </div>

          {/* avatar grid */}
          <div className="flex flex-wrap gap-3 max-h-64 overflow-y-auto py-1">
            {loadingAvatars && avatars.length === 0
              ? Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="w-14 h-14 rounded-full bg-muted animate-pulse" />
                ))
              : avatars.map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => {
                      setSelected(url);
                      setCustomFile(null);
                      setCustomPreview(null);
                    }}
                    className={`w-14 h-14 rounded-full overflow-hidden border-2 transition-all duration-150 focus:outline-none ${
                      selected === url
                        ? "border-primary ring-2 ring-primary/30 scale-110 shadow-lg"
                        : "border-transparent opacity-60 hover:opacity-100 hover:scale-105"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="Avatar option" className="w-full h-full object-cover bg-muted" />
                  </button>
                ))}

            {/* custom upload tile */}
            <button
              type="button"
              onClick={() => {
                fileInputRef.current?.click();
                setSelected("custom");
              }}
              className={`w-14 h-14 rounded-full overflow-hidden border-2 flex items-center justify-center transition-all duration-150 focus:outline-none ${
                selected === "custom"
                  ? "border-primary ring-2 ring-primary/30 scale-110 shadow-lg bg-primary/5"
                  : "border-dashed border-muted-foreground/40 opacity-60 hover:opacity-100 hover:scale-105 bg-muted/30"
              }`}
            >
              {customPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={customPreview} alt="Custom avatar preview" className="w-full h-full object-cover" />
              ) : (
                <Upload className="h-5 w-5 text-muted-foreground" />
              )}
            </button>

            <Input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFilePick}
              onClick={(e) => {
                (e.target as HTMLInputElement).value = "";
              }}
            />
          </div>

          {selected === "custom" && !customPreview && (
            <p className="text-sm text-muted-foreground -mt-1">
              Click the upload tile to choose a photo from your device.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !selected}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save Avatar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

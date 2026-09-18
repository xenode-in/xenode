"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ImagePlus, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import {
  Avatar,
  AvatarImage,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
} from "@xenode/ui";
import {
  generateAvatarBatch,
  type GeneratedAvatar,
} from "@/components/onboarding/avatars";
import { MAX_PROFILE_IMAGE_LENGTH } from "@/lib/profile-image";

type Profile = {
  name: string;
  email: string;
  username: string;
  displayUsername: string;
  image: string | null;
  emailVerified: boolean;
  defaultEncrypt: boolean;
  createdAt: string | null;
};

async function resizeImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  const bitmap = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image editing is unavailable.");
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(
    bitmap,
    (size - width) / 2,
    (size - height) / 2,
    width,
    height,
  );
  bitmap.close();
  const value = canvas.toDataURL("image/jpeg", 0.82);
  if (value.length > MAX_PROFILE_IMAGE_LENGTH) {
    throw new Error("That image is too complex. Try a smaller image.");
  }
  return value;
}

export function ProfileForm({ initialProfile }: { initialProfile: Profile }) {
  const router = useRouter();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [avatars, setAvatars] = useState<GeneratedAvatar[]>(() =>
    generateAvatarBatch(),
  );
  const [name, setName] = useState(initialProfile.name);
  const [username, setUsername] = useState(initialProfile.username);
  const [image, setImage] = useState(
    initialProfile.image ?? avatars[0]?.url ?? "",
  );
  const [defaultEncrypt, setDefaultEncrypt] = useState(
    initialProfile.defaultEncrypt,
  );
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  function shuffle() {
    const batch = generateAvatarBatch();
    setAvatars(batch);
    setImage(batch[0]?.url ?? image);
    setStatus("");
  }

  async function upload(file?: File) {
    if (!file) return;
    setError(false);
    setStatus("");
    try {
      setImage(await resizeImage(file));
    } catch (uploadError) {
      setError(true);
      setStatus(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not read that image.",
      );
    } finally {
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    setError(false);
    const response = await fetch("/api/profile", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, username, image, defaultEncrypt }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    setBusy(false);
    if (!response.ok) {
      setError(true);
      setStatus(payload?.error ?? "Could not update your profile.");
      return;
    }
    setStatus("Profile updated.");
    router.refresh();
  }

  return (
    <form className="grid gap-6 lg:grid-cols-[340px_1fr]" onSubmit={save}>
      <Card className="h-fit bg-card/80 backdrop-blur">
        <CardHeader>
          <CardTitle>Your picture</CardTitle>
          <CardDescription>
            Pick a Lorelei avatar or attach your own image.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-4">
            <Avatar className="size-24 border-4 border-background shadow-xl">
              <AvatarImage src={image} alt={`${name || "Profile"} avatar`} />
            </Avatar>
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => uploadRef.current?.click()}
              >
                <ImagePlus />
                Upload image
              </Button>
              <input
                ref={uploadRef}
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(event) => void upload(event.target.files?.[0])}
              />
              <p className="text-xs text-muted-foreground">
                Cropped to a private 256 px preview.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {avatars.map((avatar) => (
              <button
                key={avatar.id}
                type="button"
                aria-label="Choose this Lorelei avatar"
                aria-pressed={image === avatar.url}
                className={`relative overflow-hidden rounded-xl border-2 transition hover:-translate-y-0.5 ${
                  image === avatar.url
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-transparent"
                }`}
                onClick={() => setImage(avatar.url)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={avatar.url} alt="" className="aspect-square w-full" />
                {image === avatar.url ? (
                  <span className="absolute bottom-1 right-1 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3" />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <Button type="button" variant="ghost" className="w-full" onClick={shuffle}>
            <RefreshCw />
            Shuffle avatars
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-card/80 backdrop-blur">
        <CardHeader>
          <CardTitle>Personal details</CardTitle>
          <CardDescription>
            This identity appears across Xenode products.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-2">
            <Label htmlFor="name">Display name</Label>
            <Input
              id="name"
              value={name}
              minLength={1}
              maxLength={80}
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={username}
              minLength={3}
              maxLength={30}
              pattern="[A-Za-z0-9_.]+"
              autoCapitalize="none"
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Letters, numbers, underscores, and periods.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Verified email</Label>
            <div className="relative">
              <Input id="email" value={initialProfile.email} disabled />
              {initialProfile.emailVerified ? (
                <ShieldCheck className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-emerald-600" />
              ) : null}
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
            <div>
              <Label htmlFor="default-encrypt">Encrypt new content</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Keep encryption enabled by default in Xenode products.
              </p>
            </div>
            <Switch
              id="default-encrypt"
              checked={defaultEncrypt}
              onCheckedChange={setDefaultEncrypt}
            />
          </div>
          {status ? (
            <p
              className={`text-sm ${error ? "text-destructive" : "text-emerald-600"}`}
              role="status"
            >
              {status}
            </p>
          ) : null}
          <Button className="w-full sm:w-auto" disabled={busy || !image} type="submit">
            {busy ? <Loader2 className="animate-spin" /> : null}
            {busy ? "Saving…" : "Save profile"}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}

"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Download,
  Lock,
  File,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";

interface ShareMeta {
  fileName: string;
  size: number;
  contentType: string;
  isEncrypted: boolean;
  thumbnail?: string;
  isPasswordProtected: boolean;
  expiresAt?: string;
  downloadCount: number;
  maxDownloads?: number;
  shareEncryptedDEK?: string;
  shareKeyIv?: string;
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function b64urlToBytes(s: string): Uint8Array {
  return b64ToBytes(
    s
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(s.length + ((4 - (s.length % 4)) % 4), "="),
  );
}
function bytesToB64(buf: ArrayBuffer | Uint8Array): string {
  return btoa(
    String.fromCharCode(
      ...new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer),
    ),
  );
}
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

export default function SharedFilePage() {
  const { token } = useParams<{ token: string }>();
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [done, setDone] = useState(false);
  const [shareKey, setShareKey] = useState("");

  // Share key is ONLY in the URL fragment — never sent to server
  useEffect(() => {
    if (typeof window !== "undefined") {
      setShareKey(window.location.hash.replace("#key=", ""));
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/share/${token}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setMeta(d)))
      .catch(() => setError("Failed to load share info"));
  }, [token]);

  async function handleDownload() {
    if (!meta) return;
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`/api/share/${token}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const fileRes = await fetch(data.downloadUrl);
      if (!fileRes.ok) throw new Error("Failed to fetch file");

      let blob: Blob;

      if (
        data.isEncrypted &&
        shareKey &&
        meta.shareEncryptedDEK &&
        meta.shareKeyIv
      ) {
        // Client-side decryption — share key from URL fragment
        const raw = await fileRes.arrayBuffer();
        const skBytes = b64urlToBytes(shareKey);
        const shareKeyObj = await crypto.subtle.importKey(
          "raw",
          skBytes,
          { name: "AES-GCM" },
          false,
          ["unwrapKey"],
        );
        const dek = await crypto.subtle.unwrapKey(
          "raw",
          b64ToBytes(meta.shareEncryptedDEK),
          shareKeyObj,
          { name: "AES-GCM", iv: b64ToBytes(meta.shareKeyIv) },
          { name: "AES-GCM" },
          false,
          ["decrypt"],
        );
        const decrypted = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: b64ToBytes(data.iv) },
          dek,
          raw,
        );
        blob = new Blob([decrypted], { type: data.contentType });
      } else {
        blob = await fileRes.blob();
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        data.fileName || meta.fileName.split("/").pop() || "download";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDone(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  if (error && !meta)
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center space-y-3">
            <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
            <p className="font-semibold text-foreground">{error}</p>
            <p className="text-sm text-muted-foreground">
              This link may have expired, been revoked, or never existed.
            </p>
          </CardContent>
        </Card>
      </div>
    );

  if (!meta)
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );

  const displayName = meta.fileName.split("/").pop() || meta.fileName;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            {meta.thumbnail ? (
              <img
                src={meta.thumbnail}
                alt={displayName}
                className="h-16 w-16 rounded-full object-cover"
              />
            ) : (
              <File className="h-8 w-8 text-primary" />
            )}
          </div>
          <CardTitle className="break-all text-lg text-foreground">
            {displayName}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {formatBytes(meta.size)}
          </p>
          {meta.isEncrypted && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-500 mt-1">
              <Lock className="h-3 w-3" /> End-to-End Encrypted
            </span>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {meta.expiresAt && (
            <p className="text-center text-xs text-muted-foreground">
              Expires {new Date(meta.expiresAt).toLocaleString()}
            </p>
          )}
          {meta.maxDownloads && (
            <p className="text-center text-xs text-muted-foreground">
              {meta.downloadCount} / {meta.maxDownloads} downloads used
            </p>
          )}

          {meta.isPasswordProtected && !done && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" /> Password
              </label>
              <Input
                type="password"
                placeholder="Enter password to access this file"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleDownload()}
                className="bg-secondary/50 border-border"
              />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {done ? (
            <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-500">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> Downloaded
              successfully!
            </div>
          ) : (
            <Button
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleDownload}
              disabled={downloading || (meta.isPasswordProtected && !password)}
            >
              {downloading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {meta.isEncrypted ? "Decrypting…" : "Downloading…"}
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" /> Download
                </>
              )}
            </Button>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Shared via{" "}
            <a
              href="/"
              className="underline hover:text-primary transition-colors"
            >
              XNode Drive
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, X, Lock } from "lucide-react";

import { Plyr } from "plyr-react";
import "plyr-react/plyr.css";

import DocViewer, { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import { useCrypto } from "@/contexts/CryptoContext";
import { decryptFile } from "@/lib/crypto/fileEncryption";

interface ObjectData {
  id: string;
  key: string;
  size: number;
  contentType: string;
  createdAt: string;
  isEncrypted?: boolean;
}

interface FilePreviewDialogProps {
  file: ObjectData | null;
  isOpen: boolean;
  onClose: () => void;
}

const MediaPlayer = ({ url, type }: { url: string; type: string }) => {
  const isAudio = type.startsWith("audio/");
  return (
    <div className={isAudio ? "w-full p-4" : "w-full"}>
      <Plyr
        source={{
          type: isAudio ? "audio" : "video",
          sources: [{ src: url, type }],
        }}
        options={{ autoplay: true }}
      />
    </div>
  );
};

const MemoizedMediaPlayer = React.memo(MediaPlayer);

function fileNameFromKey(key: string) {
  const part = key.split("/").pop();
  return part || key;
}

function formatMB(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2);
}

export function FilePreviewDialog({
  file,
  isOpen,
  onClose,
}: FilePreviewDialogProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isEncrypted, setIsEncrypted] = useState(false);

  // Track object URLs we created so we can revoke them on close
  const objectUrlRef = useRef<string | null>(null);

  const { privateKey, setModalOpen } = useCrypto();

  const isLockedOut = file?.isEncrypted && !privateKey;

  // If locked out, prevent dialog from opening, trigger modal, and close preview
  useEffect(() => {
    if (isOpen && isLockedOut) {
      setModalOpen(true);
      onClose();
    }
  }, [isOpen, isLockedOut, setModalOpen, onClose]);

  // Revoke any object URL when the dialog closes or file changes
  useEffect(() => {
    if (!isOpen) {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setUrl(null);
      setError("");
      setIsEncrypted(false);
    }
  }, [isOpen]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // Don't run the fetch if we are locked out (prevents unnecessary network requests)
      if (!isOpen || !file || isLockedOut) return;

      setLoading(true);
      setError("");
      setUrl(null);

      try {
        // 1. Fetch metadata + signed URL from our API
        const res = await fetch(`/api/objects/${file.id}`);
        if (!res.ok) throw new Error("Failed to get URL");
        const data = await res.json();
        if (!data?.url) throw new Error("No URL returned");

        const encrypted: boolean = data.isEncrypted ?? false;

        if (!encrypted) {
          // Legacy plaintext file — use the signed URL directly
          if (!cancelled) {
            setUrl(data.url);
            setIsEncrypted(false);
          }
          return;
        }

        // 2. Encrypted file — need private key to decrypt
        setIsEncrypted(true);

        if (!privateKey) {
          setModalOpen(true);
          throw new Error(
            "Your files are encrypted. Please unlock your vault to preview this file.",
          );
        }

        // 3. Fetch raw ciphertext via same-origin proxy to avoid CDN CORS block
        const ciphertextRes = await fetch(`/api/objects/${file.id}/content`);
        if (!ciphertextRes.ok) throw new Error("Failed to download file");
        const ciphertextBuf = await ciphertextRes.arrayBuffer();

        // 4. Decrypt
        const decryptedBlob = await decryptFile(
          ciphertextBuf,
          data.encryptedDEK,
          data.iv,
          privateKey,
          data.contentType ?? file.contentType,
        );

        // 5. Create object URL from decrypted blob
        const objectUrl = URL.createObjectURL(decryptedBlob);
        objectUrlRef.current = objectUrl;

        if (!cancelled) setUrl(objectUrl);
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : "Failed to load preview. Please try downloading instead.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, file, privateKey]);

  const docs = useMemo(() => {
    if (!url || !file) return [];
    return [{ uri: url, fileType: file.contentType }];
  }, [url, file]);

  if (!file) return null;

  const name = fileNameFromKey(file.key);
  const type = file.contentType;

  // Download handler: for encrypted files, trigger programmatic download
  // from the decrypted Blob URL instead of opening the ciphertext URL.
  const handleDownload = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="grid h-full min-h-[40vh] place-items-center">
          <div className="flex flex-col items-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-3 text-sm text-muted-foreground">
              {isEncrypted ? "Decrypting file..." : "Loading preview..."}
            </p>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="grid h-full min-h-[40vh] place-items-center px-6 text-center">
          <div className="flex flex-col items-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <p className="mt-3 text-sm text-destructive">{error}</p>
            <div className="mt-5 flex gap-2">
              <DialogClose asChild>
                <Button variant="secondary">Close</Button>
              </DialogClose>
            </div>
          </div>
        </div>
      );
    }

    if (!url) return null;

    // Image
    if (type.startsWith("image/")) {
      return (
        <div className="grid h-full place-items-center bg-black/40 p-2 sm:p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={name}
            className="max-h-[calc(100dvh-8.5rem)] w-auto max-w-full object-contain"
          />
        </div>
      );
    }

    // Video or Audio
    if (type.startsWith("video/") || type.startsWith("audio/")) {
      return (
        <div className="h-full w-full bg-black flex items-center justify-center flex-col">
          <div className={type.startsWith("video/") ? "aspect-video" : "py-4"}>
            <MemoizedMediaPlayer url={url} type={type} />
          </div>
        </div>
      );
    }

    // PDF
    if (type === "application/pdf") {
      return (
        <div className="h-full w-full bg-white">
          <iframe src={url} className="h-full w-full border-0" title={name} />
        </div>
      );
    }

    // Other docs (DocViewer)
    return (
      <div className="h-full w-full bg-white">
        <DocViewer
          documents={docs}
          pluginRenderers={DocViewerRenderers}
          config={{
            header: {
              disableHeader: true,
              disableFileName: true,
              retainURLParams: true,
            },
            pdfVerticalScrollByDefault: true,
          }}
          style={{ height: "100%" }}
        />
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="
        p-0 overflow-hidden bg-card border-border
        w-screen max-w-full h-[100dvh] max-h-[100dvh] rounded-none
        sm:rounded-xl
        sm:w-[calc(100vw-2rem)] sm:max-w-5xl sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)]
        lg:max-w-6xl
      "
      >
        <div className="flex h-full w-full flex-col overflow-x-hidden">
          {/* Top bar */}
          <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b bg-card/95 px-4 py-3 backdrop-blur sm:px-5">
            <div className="min-w-0">
              <DialogTitle className="truncate text-sm font-medium sm:text-base flex items-center gap-1.5">
                {isEncrypted && (
                  <Lock
                    className="h-3.5 w-3.5 shrink-0 text-primary"
                    aria-label="Encrypted"
                  />
                )}
                {name}
              </DialogTitle>
              <DialogDescription className="truncate text-xs text-muted-foreground">
                {formatMB(file.size)} MB • {file.contentType}
                {isEncrypted && " • e2e encrypted"}
              </DialogDescription>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {url && (
                <Button variant="outline" size="sm" onClick={handleDownload}>
                  Download
                </Button>
              )}

              <DialogClose asChild>
                <Button variant="ghost" size="icon" aria-label="Close">
                  <X className="h-5 w-5" />
                </Button>
              </DialogClose>
            </div>
          </div>

          {/* Preview area */}
          <div className="flex-1 overflow-hidden">
            <div className="h-full w-full">{renderContent()}</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

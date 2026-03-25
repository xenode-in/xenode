"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, UploadCloud, FileArchive, CheckCircle2 } from "lucide-react";
import { BlobReader, BlobWriter, ZipReader } from "@zip.js/zip.js";
import { useCrypto } from "@/contexts/CryptoContext";
import { useSession } from "@/lib/auth/client";
import {
  encryptFile,
  encryptFileChunked,
  encryptMetadataString,
  encryptThumbnail,
} from "@/lib/crypto/fileEncryption";
import { fromB64, toB64 } from "@/lib/crypto/utils";

interface StartMigrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// Helper to resize image and get base64
const generateThumbnail = (file: File): Promise<string | undefined> => {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) {
      resolve(undefined);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_SIZE = 320;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        } else {
          resolve(undefined);
        }
      };
      img.onerror = () => resolve(undefined);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
};

function getAdaptiveChunkSize(fileSize: number, mimeType: string): number {
  const isStreamable =
    mimeType.startsWith("video/") || mimeType.startsWith("audio/");
  if (isStreamable) {
    if (fileSize < 100 * 1024 * 1024) return 2 * 1024 * 1024;
    if (fileSize < 1024 * 1024 * 1024) return 4 * 1024 * 1024;
    return 8 * 1024 * 1024;
  }
  const adaptive = Math.max(8 * 1024 * 1024, Math.floor(fileSize / 100));
  return Math.min(adaptive, 64 * 1024 * 1024);
}

const getMimeType = (filename: string): string => {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
};

const getMediaCategory = (contentType: string): string => {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.includes("pdf") || contentType.includes("document"))
    return "document";
  return "other";
};

const isMedia = (filename: string): boolean => {
  const ext = filename.split(".").pop()?.toLowerCase();
  return (
    !!ext &&
    ["jpg", "jpeg", "png", "gif", "webp", "mp4", "mov", "webm"].includes(ext)
  );
};

export function StartMigrationDialog({
  open,
  onOpenChange,
  onSuccess,
}: StartMigrationDialogProps) {
  const [destinationBucketId, setDestinationBucketId] = useState<string>("");
  const [destinationPath, setDestinationPath] = useState<string>("");
  const [takeoutFiles, setTakeoutFiles] = useState<File[]>([]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [overallProgress, setOverallProgress] = useState(0);
  const [currentFileProgress, setCurrentFileProgress] = useState(0);
  const [stats, setStats] = useState({ totalFiles: 0, processedFiles: 0 });

  const { publicKey, metadataKey } = useCrypto();
  const { data: session } = useSession();

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      fetchConfig();
    } else {
      setTakeoutFiles([]);
      setIsProcessing(false);
      setStatusText("");
      setOverallProgress(0);
      setCurrentFileProgress(0);
      setStats({ totalFiles: 0, processedFiles: 0 });
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    }
  }, [open]);

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
      console.error("Failed to load destination bucket", err);
    }
  };

  const getShouldEncrypt = () => {
    // @ts-expect-error extra fields
    return !!(publicKey && session?.user?.encryptByDefault);
  };

  const processAndUploadFile = async (rawFile: File, signal: AbortSignal) => {
    if (signal.aborted) throw new Error("Aborted");

    const uploadEncryptedThumbnail = async (
      encryptedDataUrl: string,
      bucketId: string,
      fileStorageKey: string,
    ): Promise<string | undefined> => {
      try {
        const thumbKey = `${fileStorageKey}-thumb`;
        const bytes = new TextEncoder().encode(encryptedDataUrl);
        const blob = new Blob([bytes], { type: "application/octet-stream" });

        const presign = await fetch("/api/objects/presign-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: `${fileStorageKey.split("/").pop()}-thumb`,
            fileSize: blob.size,
            fileType: "application/octet-stream",
            bucketId,
            prefix: fileStorageKey.includes("/")
              ? fileStorageKey.substring(0, fileStorageKey.lastIndexOf("/") + 1)
              : `users/${session?.user?.id}/`,
          }),
        });
        const { uploadUrl } = await presign.json();
        await fetch(uploadUrl, { method: "PUT", body: blob, signal });
        return thumbKey;
      } catch (err) {
        console.error("Failed to upload thumbnail to B2:", err);
        return undefined;
      }
    };

    let uploadBody: File | Blob = rawFile;
    let uploadContentType = rawFile.type;
    let encryptedDEK: string | undefined;
    let encryptedIV: string | undefined;
    let encryptedName: string | undefined;
    let chunkSize: number | undefined;
    let chunkCount: number | undefined;
    let chunkIvs: string | undefined;

    const shouldEncryptNow = getShouldEncrypt();

    // Attempt Encryption
    if (shouldEncryptNow && publicKey) {
      try {
        const isStreamable =
          rawFile.type.startsWith("video/") ||
          rawFile.type.startsWith("audio/");
        if (isStreamable) {
          const enc = await encryptFileChunked(rawFile, publicKey);
          uploadBody = enc.ciphertext;
          encryptedDEK = enc.encryptedDEK;
          chunkSize = enc.chunkSize;
          chunkCount = enc.chunkCount;
          chunkIvs = JSON.stringify(enc.chunkIvs);
        } else {
          const enc = await encryptFile(rawFile, publicKey);
          uploadBody = enc.ciphertext;
          encryptedDEK = enc.encryptedDEK;
          encryptedIV = enc.iv;
        }
        uploadContentType = "application/octet-stream";

        if (metadataKey) {
          encryptedName = await encryptMetadataString(
            rawFile.name,
            metadataKey,
          );
        }
      } catch (err) {
        console.warn("[E2EE] Encryption failed, uploading plaintext", err);
        uploadBody = rawFile;
      }
    }

    if (signal.aborted) throw new Error("Aborted");

    const rawThumbnail = await generateThumbnail(rawFile).catch(
      () => undefined,
    );
    const thumbnail =
      rawThumbnail && shouldEncryptNow && metadataKey
        ? await encryptThumbnail(rawThumbnail, metadataKey).catch(
            () => undefined,
          )
        : rawThumbnail;

    // Get Presigned URLs
    const isStreamableEncrypted =
      shouldEncryptNow &&
      (rawFile.type.startsWith("video/") || rawFile.type.startsWith("audio/"));

    const endpoint = isStreamableEncrypted
      ? "/api/objects/presign-upload-multipart"
      : "/api/objects/presign-upload";

    const presignReqType = isStreamableEncrypted
      ? {
          fileName: shouldEncryptNow ? crypto.randomUUID() : rawFile.name,
          fileSize: uploadBody.size,
          fileType: uploadContentType,
          bucketId: destinationBucketId,
          prefix: destinationPath,
          chunkCount,
          chunkSize,
        }
      : {
          fileName: shouldEncryptNow ? crypto.randomUUID() : rawFile.name,
          fileSize: uploadBody.size,
          fileType: uploadContentType,
          bucketId: destinationBucketId,
          prefix: destinationPath,
        };

    const presignResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(presignReqType),
    });

    if (!presignResponse.ok) throw new Error("Failed to presign upload");
    const pData = await presignResponse.json();

    if (signal.aborted) throw new Error("Aborted");

    let chunkUploadRefs: { index: number; key: string; size: number }[] = [];

    // XHR Upload execution
    if (isStreamableEncrypted) {
      // Multipart upload
      const {
        fileId,
        urls,
        bucketId: returnedBucketId,
        chunkSize: serverChunkSize,
      } = pData;
      let urlIndex = 0;
      const totalSize = uploadBody.size;
      const loadedBytes = new Array(urls.length).fill(0);

      const cipherChunkSize = (chunkSize || 0) + 16;
      const concurrency = 4;

      const uploadWorker = async () => {
        while (urlIndex < urls.length) {
          if (signal.aborted) throw new Error("Aborted");
          const currentIndex = urlIndex++;
          const urlObj = urls[currentIndex];
          const start = currentIndex * cipherChunkSize;
          const end = Math.min(start + cipherChunkSize, totalSize);
          const chunkBlob = uploadBody.slice(start, end);

          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const abortHandler = () => {
              xhr.abort();
              reject(new Error("Aborted"));
            };
            signal.addEventListener("abort", abortHandler);

            xhr.upload.addEventListener("progress", (e) => {
              if (e.lengthComputable) {
                loadedBytes[currentIndex] = e.loaded;
                const totalLoaded = loadedBytes.reduce((a, b) => a + b, 0);
                setCurrentFileProgress(
                  Math.round((totalLoaded / totalSize) * 100),
                );
              }
            });
            xhr.addEventListener("load", () => {
              signal.removeEventListener("abort", abortHandler);
              if (xhr.status >= 200 && xhr.status < 300) {
                loadedBytes[currentIndex] = chunkBlob.size;
                chunkUploadRefs.push({
                  index: currentIndex,
                  key: urlObj.key,
                  size: chunkBlob.size,
                });
                resolve();
              } else reject(new Error("Upload failed"));
            });
            xhr.addEventListener("error", () =>
              reject(new Error("Network Error")),
            );
            xhr.open("PUT", urlObj.url);
            xhr.setRequestHeader("Content-Type", uploadContentType);
            xhr.send(chunkBlob);
          });
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(concurrency, urls.length) },
          uploadWorker,
        ),
      );
      chunkUploadRefs.sort((a, b) => a.index - b.index);

      if (signal.aborted) throw new Error("Aborted");

      // Handle thumbnail upload to B2
      let thumbnailKey: string | undefined;
      if (thumbnail && thumbnail.startsWith("enc:")) {
        thumbnailKey = await uploadEncryptedThumbnail(
          thumbnail,
          returnedBucketId,
          fileId,
        );
      }

      const res = await fetch("/api/objects/complete-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectKey: fileId,
          bucketId: returnedBucketId,
          size: totalSize,
          contentType: shouldEncryptNow
            ? "application/octet-stream"
            : rawFile.type,
          originalContentType: rawFile.type,
          mediaCategory: getMediaCategory(rawFile.type),
          encryptedContentType:
            shouldEncryptNow && metadataKey
              ? await encryptMetadataString(rawFile.type, metadataKey)
              : undefined,
          thumbnail: thumbnailKey || thumbnail,
          thumbnailKey,
          isEncrypted: !!encryptedDEK,
          encryptedDEK,
          encryptedName,
          chunkSize: serverChunkSize,
          chunkCount: urls.length,
          chunkIvs,
          isChunked: true,
          chunks: chunkUploadRefs,
        }),
      });
      return await res.json();
    } else {
      // Single Blob upload
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const abortHandler = () => {
          xhr.abort();
          reject(new Error("Aborted"));
        };
        signal.addEventListener("abort", abortHandler);

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            setCurrentFileProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
        xhr.addEventListener("load", () => {
          signal.removeEventListener("abort", abortHandler);
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`B2 error ${xhr.status}`));
        });
        xhr.addEventListener("error", () => reject(new Error("Network error")));
        xhr.open("PUT", pData.uploadUrl);
        xhr.setRequestHeader("Content-Type", uploadContentType);
        xhr.send(uploadBody);
      });

      if (signal.aborted) throw new Error("Aborted");

      // Handle thumbnail upload to B2
      let thumbnailKey: string | undefined;
      if (thumbnail && thumbnail.startsWith("enc:")) {
        thumbnailKey = await uploadEncryptedThumbnail(
          thumbnail,
          pData.bucketId,
          pData.objectKey,
        );
      }

      const res = await fetch("/api/objects/complete-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectKey: pData.objectKey,
          bucketId: pData.bucketId,
          size: uploadBody.size,
          contentType: shouldEncryptNow
            ? "application/octet-stream"
            : rawFile.type,
          originalContentType: rawFile.type,
          mediaCategory: getMediaCategory(rawFile.type),
          encryptedContentType:
            shouldEncryptNow && metadataKey
              ? await encryptMetadataString(rawFile.type, metadataKey)
              : undefined,
          thumbnail: thumbnailKey || thumbnail,
          thumbnailKey,
          isEncrypted: !!encryptedDEK,
          encryptedDEK,
          iv: encryptedIV,
          encryptedName,
          chunkSize,
          chunkCount,
          chunkIvs,
        }),
      });
      return await res.json();
    }
  };

  const processAndUploadFileWithMetadata = async (
    file: File,
    metadata: any,
    signal: AbortSignal,
  ) => {
    const uploadResult = await processAndUploadFile(file, signal);

    const objectKey = uploadResult?.object?.key;
    const bucketId = uploadResult?.bucketId;

    if (!objectKey) {
      console.error("Missing objectKey — cannot update metadata");
      return;
    }

    try {
      await fetch("/api/objects/update-metadata", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          objectKey,
          bucketId,
          takenAt: metadata?.photoTakenTime?.timestamp,
          createdAt: metadata?.creationTime?.timestamp,
          description: metadata?.description || "",
          googlePhotosUrl: metadata?.url,
        }),
      });
    } catch (err) {
      console.warn("Metadata update failed", err);
    }
  };

  const isMetadataFile = (filename: string) => {
    return (
      filename.endsWith(".json") &&
      (filename.includes(".supplemental") ||
        filename.match(/\.(jpg|jpeg|png|webp|mp4|mov|webm)\.json$/i) ||
        !filename.match(/\.(jpg|jpeg|png|webp|mp4|mov|webm)$/i))
    );
  };

  const getBaseNameFromMetadata = (filename: string) => {
    return filename
      .replace(".supplemental-metadata.json", "")
      .replace(".supplemental-met.json", "")
      .replace(/\.json$/, "")
      .trim();
  };

  const normalize = (name: string) =>
    name
      .replace(/\(\d+\)/g, "") // remove (1), (2)
      .replace(/\s+/g, " ") // normalize spaces
      .trim()
      .toLowerCase();

  const startExtraction = async () => {
    if (!takeoutFiles.length) return;

    setIsProcessing(true);
    setStatusText("Analyzing ZIP files...");
    setStats({ totalFiles: 0, processedFiles: 0 });

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    const normalize = (name: string) => name.replace(/\(\d+\)/, "").trim();

    try {
      const metadataMap = new Map<string, any>();

      let mediaEntriesTotal = 0;
      const allMediaRefs: {
        entry: any;
        zipReader: ZipReader<any>;
        normalizedName: string;
      }[] = [];

      // -------------------------------
      // PASS 1 → READ ALL FILES
      // -------------------------------
      for (let i = 0; i < takeoutFiles.length; i++) {
        const zipReader = new ZipReader(new BlobReader(takeoutFiles[i]));
        const entries = await zipReader.getEntries();

        for (const entry of entries) {
          if (entry.directory) continue;

          const filename = entry.filename.split("/").pop();
          if (!filename) continue;

          // -------------------------
          // HANDLE METADATA FILES
          // -------------------------
          if (isMetadataFile(filename)) {
            try {
              const blob = await entry.getData(
                new BlobWriter("application/json"),
              );
              const text = await blob.text();
              const parsed = JSON.parse(text);

              const baseName = normalize(getBaseNameFromMetadata(filename));

              metadataMap.set(baseName, parsed);
            } catch (err) {
              console.warn("Failed to parse metadata:", filename);
            }

            continue;
          }

          // -------------------------
          // HANDLE MEDIA FILES
          // -------------------------
          if (isMedia(filename)) {
            mediaEntriesTotal++;

            allMediaRefs.push({
              entry,
              zipReader,
              normalizedName: normalize(filename),
            });
          }
        }
      }

      setStats({ totalFiles: mediaEntriesTotal, processedFiles: 0 });

      // -------------------------------
      // PASS 2 → PROCESS MEDIA
      // -------------------------------
      let processed = 0;

      for (const meta of allMediaRefs) {
        if (signal.aborted) break;

        const filename = meta.entry.filename.split("/").pop() || "file";

        setCurrentFileProgress(0);
        setStatusText(`Processing ${filename}...`);

        let metadata = metadataMap.get(meta.normalizedName);

        // fallback: try partial match (important for weird cases)
        if (!metadata) {
          for (const [key, value] of metadataMap.entries()) {
            if (
              meta.normalizedName.includes(key) ||
              key.includes(meta.normalizedName)
            ) {
              metadata = value;
              break;
            }
          }
        }

        // 🔥 Extract file
        const blob = await meta.entry.getData(
          new BlobWriter(getMimeType(filename)),
        );

        // ✅ FIX TIMESTAMP (MOST IMPORTANT PART)
        const takenTime = metadata?.photoTakenTime?.timestamp;
        const creationTime = metadata?.creationTime?.timestamp;

        const finalTimestamp = takenTime || creationTime;

        const file = new File([blob], filename, {
          type: getMimeType(filename),
          lastModified: finalTimestamp
            ? Number(finalTimestamp) * 1000
            : meta.entry.lastModDate?.getTime() || Date.now(),
        });

        // 🔥 Upload with metadata
        await processAndUploadFileWithMetadata(file, metadata, signal);

        processed++;
        setStats((prev) => ({ ...prev, processedFiles: processed }));
        setOverallProgress(Math.round((processed / mediaEntriesTotal) * 100));
      }

      // Cleanup
      for (const reader of new Set(allMediaRefs.map((r) => r.zipReader))) {
        await reader.close();
      }

      setStatusText("Migration Complete!");

      setTimeout(() => {
        onSuccess();
        onOpenChange(false);
      }, 2000);
    } catch (err: any) {
      if (err.message !== "Aborted") {
        console.error("Takeout parsing crashed", err);
        setStatusText("Migration failed: " + err.message);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleCancel}>
      <DialogContent className="w-[95vw] max-w-lg sm:max-w-xl rounded-xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg">
            Google Takeout Migration
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Import your photos securely in the browser. Supports End-to-End
            Encryption out of the box.
          </DialogDescription>
        </DialogHeader>

        {!isProcessing && stats.processedFiles === 0 ? (
          <div className="flex flex-col gap-4 overflow-y-auto pr-1">
            <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
              <p className="text-sm font-medium">
                Step 1: Get your Takeout archive
              </p>
              <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground pb-2 border-b">
                <li>
                  Go to{" "}
                  <a
                    href="https://takeout.google.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    takeout.google.com
                  </a>
                </li>
                <li>
                  Deselect all, then select <strong>Google Photos</strong>
                </li>
                <li>Export as ZIP and download to your local device.</li>
              </ol>

              <p className="text-sm font-medium pt-2">
                Step 2: Drop ZIP files below
              </p>
              <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border rounded-xl hover:bg-muted/30 transition-colors cursor-pointer group">
                <UploadCloud className="w-10 h-10 text-muted-foreground group-hover:text-primary transition-colors mb-4" />
                <p className="text-sm font-medium text-foreground mb-1 text-center">
                  Drag and drop ZIP files here
                </p>
                <p className="text-xs text-muted-foreground text-center">
                  Multi-part exports supported (e.g. Takeout-001.zip,
                  Takeout-002.zip)
                </p>
                <input
                  type="file"
                  multiple
                  accept=".zip"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      setTakeoutFiles(Array.from(e.target.files));
                    }
                  }}
                />
              </label>

              {takeoutFiles.length > 0 && (
                <div className="space-y-2 mt-4 max-h-[150px] overflow-y-auto bg-background border rounded-md p-2">
                  <p className="text-xs font-semibold px-2">
                    Ready to process ({takeoutFiles.length} chunk
                    {takeoutFiles.length > 1 ? "s" : ""}):
                  </p>
                  {takeoutFiles.map((file, i) => (
                    <div
                      key={i}
                      className="flex items-center text-xs text-muted-foreground px-2 py-1"
                    >
                      <FileArchive className="w-4 h-4 mr-2 text-primary" />
                      <span className="truncate flex-1">{file.name}</span>
                      <span>{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Destination</label>
              <div className="p-3 bg-secondary rounded-md text-xs sm:text-sm">
                <span className="font-semibold">Xenode Storage</span> /{" "}
                {destinationPath || ""}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 justify-end pt-2 border-t">
              <Button type="button" variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                onClick={startExtraction}
                disabled={!takeoutFiles.length || !destinationBucketId}
              >
                Start Extraction
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 space-y-6">
            {overallProgress >= 100 ? (
              <CheckCircle2 className="w-16 h-16 text-emerald-500 animate-in zoom-in" />
            ) : (
              <div className="relative flex items-center justify-center w-16 h-16">
                <Loader2 className="w-16 h-16 text-primary animate-spin absolute" />
              </div>
            )}

            <div className="text-center w-full px-6 space-y-2">
              <h3 className="font-semibold text-lg">{statusText}</h3>
              <p className="text-sm text-muted-foreground">
                {stats.processedFiles} of {stats.totalFiles} media files
                migrated
              </p>

              <div className="w-full space-y-1 mt-6">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Overall Progress</span>
                  <span>{overallProgress}%</span>
                </div>
                <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 ease-in-out"
                    style={{ width: `${overallProgress}%` }}
                  />
                </div>
              </div>

              <div className="w-full space-y-1 mt-4">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Current File Extraction & Upload</span>
                  <span>{currentFileProgress}%</span>
                </div>
                <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/60 transition-all duration-100 ease-linear"
                    style={{ width: `${currentFileProgress}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="w-full px-6 pt-4">
              <div className="rounded-md bg-yellow-500/10 border border-yellow-500/20 p-3 text-xs text-yellow-600 dark:text-yellow-400">
                <strong>
                  Please do not close this tab or put your computer to sleep.
                </strong>{" "}
                Extraction runs entirely in your browser memory to decrypt and
                safely process files without sharing them with external servers.
              </div>
            </div>

            {!isProcessing &&
              stats.processedFiles > 0 &&
              stats.processedFiles < stats.totalFiles && (
                <p className="text-sm text-red-500">
                  Migration was stopped or cancelled.
                </p>
              )}

            {isProcessing && (
              <Button
                variant="ghost"
                onClick={handleCancel}
                className="mt-4 text-muted-foreground hover:text-red-500"
              >
                Cancel Migration
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

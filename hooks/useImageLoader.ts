import { useState, useEffect, useRef } from "react";
import { useThumbnail } from "./useThumbnail";
import {
  decryptFile,
  decryptFileChunkedCombined,
  decryptFileWithDEK,
  unwrapDEKWithSpaceKey,
} from "@/lib/crypto/fileEncryption";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { useWorkspaceSpaceKey } from "@/lib/orgs/useWorkspaceSpaceKey";

interface UseImageLoaderProps {
  thumbnail?: string;
  fileId: string;
  isEncrypted?: boolean;
  metadataKey: CryptoKey | null;
  privateKey: CryptoKey | null;
  enabled: boolean; // Based on viewport visibility
  loadFull?: boolean; // Based on grid density or preference
}

/**
 * useImageLoader hook
 * Combines thumbnail and full-image loading with viewport-based activation.
 * Initially shows the thumbnail, then upgrades to the full image when enabled.
 */
export function useImageLoader({
  thumbnail,
  fileId,
  isEncrypted,
  metadataKey,
  privateKey,
  enabled,
  loadFull = true,
}: UseImageLoaderProps) {
  const thumbnailUrl = useThumbnail(thumbnail, metadataKey);
  const workspace = useOptionalWorkspace();
  const workspaceSpaceKey = useWorkspaceSpaceKey();
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [isLoadingFull, setIsLoadingFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadFullImage() {
      if (!enabled || !loadFull || fullUrl || isLoadingFull || !fileId) return;

      setIsLoadingFull(true);
      setError(null);

      try {
        const res = workspace?.scopedFetch
          ? await workspace.scopedFetch(`/api/objects/${fileId}`)
          : await fetch(`/api/objects/${fileId}`);
        if (!res.ok) throw new Error("Failed to fetch image metadata");
        const data = await res.json();

        if (!data.url && (!data.chunkUrls || data.chunkUrls.length === 0)) {
          throw new Error("No image URL returned");
        }

        const type = data.contentType || "image/jpeg";
        let finalBlob: Blob;

        if (isEncrypted && data.isEncrypted) {
          if (!privateKey && data.wrappedBy !== "space")
            throw new Error("Private key required for decryption");

          // Standard or Chunked Fetching
          const fetchRes = await fetch(data.url);
          if (!fetchRes.ok)
            throw new Error("Failed to download encrypted file");
          const ciphertextBuf = await fetchRes.arrayBuffer();

          let workspaceDEK: CryptoKey | null = null;
          if (data.wrappedBy === "space") {
            if (!workspaceSpaceKey.rawSpaceKey || !data.spaceKeyWrapIv) {
              throw new Error("Workspace key required for decryption");
            }
            workspaceDEK = await unwrapDEKWithSpaceKey(
              data.encryptedDEK,
              data.spaceKeyWrapIv,
              workspaceSpaceKey.rawSpaceKey,
            );
          }

          if (data.chunkIvs && data.chunkSize && data.chunkCount) {
            finalBlob = await decryptFileChunkedCombined(
              ciphertextBuf,
              workspaceDEK ? null : data.encryptedDEK,
              data.chunkIvs,
              data.chunkSize,
              data.chunkCount,
              workspaceDEK ?? privateKey!,
              type,
            );
          } else if (workspaceDEK) {
            finalBlob = await decryptFileWithDEK(
              ciphertextBuf,
              workspaceDEK,
              data.iv,
              type,
            );
          } else {
            if (!data.iv || !data.encryptedDEK)
              throw new Error("Missing encryption params");
            finalBlob = await decryptFile(
              ciphertextBuf,
              data.encryptedDEK,
              data.iv,
              privateKey!,
              type,
            );
          }
        } else {
          // Plaintext
          const fetchRes = await fetch(data.url);
          if (!fetchRes.ok) throw new Error("Failed to download file");
          finalBlob = await fetchRes.blob();
        }

        if (!cancelled) {
          const objectUrl = URL.createObjectURL(finalBlob);
          objectUrlRef.current = objectUrl;
          setFullUrl(objectUrl);
        }
      } catch (err: any) {
        console.error("[useImageLoader] Error loading full image:", err);
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setIsLoadingFull(false);
      }
    }

    // Small delay to prioritize scrolling performance
    const timer = setTimeout(() => {
      loadFullImage();
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    enabled,
    loadFull,
    fileId,
    isEncrypted,
    privateKey,
    workspace,
    workspaceSpaceKey.rawSpaceKey,
    fullUrl,
    isLoadingFull,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  return {
    displayUrl: fullUrl || thumbnailUrl,
    isFull: !!fullUrl,
    isLoadingFull,
    error,
  };
}

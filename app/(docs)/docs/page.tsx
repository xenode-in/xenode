"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useCrypto } from "@/contexts/CryptoContext";
import { useDownload } from "@/contexts/DownloadContext";
import { useUpload } from "@/contexts/UploadContext";
import {
  decryptFileWithDEK,
  decryptMetadataString,
  encryptFileWithDEK
} from "@/lib/crypto/fileEncryption";
import { decryptWithShareKey } from "@/lib/crypto/fileEncryption";
import { fromB64 } from "@/lib/crypto/utils";
import { Loader2, AlertCircle, Lock } from "lucide-react";
import DocxEditor from "@/components/dashboard/DocxEditor";
import { Button } from "@/components/ui/button";

export default function DocsEditorPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const fileId = searchParams.get("id");
  
  const { privateKey, metadataKey } = useCrypto();
  const { startDownload } = useDownload();
  const { addTasks } = useUpload(); // We'll use this for the save operation

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<any>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [decryptedName, setDecryptedName] = useState<string>("");

  const loadFile = useCallback(async () => {
    if (!fileId || !privateKey || !metadataKey) return;

    try {
      setLoading(true);
      setError(null);

      // 1. Fetch metadata
      const res = await fetch(`/api/objects/${fileId}`);
      if (!res.ok) throw new Error("File not found or access denied");
      const data = await res.json();
      setFileMeta(data);

      // 2. Decrypt name
      if (data.encryptedName) {
        const name = await decryptMetadataString(data.encryptedName, metadataKey);
        setDecryptedName(name);
      }

      // 3. Download and Decrypt
      // We'll use the same logic as FilePreviewDialog but specialized for this page
      const downloadRes = await fetch(data.url);
      if (!downloadRes.ok) throw new Error("Failed to download file content");
      const encryptedBuffer = await downloadRes.arrayBuffer();

      // Get DEK
      const dek = await decryptWithShareKey(data.encryptedDEK, privateKey);
      const iv = data.iv;

      const decryptedBuffer = await decryptFileWithDEK(encryptedBuffer, dek as unknown as CryptoKey, iv, data.contentType);
      const blob = await decryptedBuffer;
      
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setBlobUrl(URL.createObjectURL(blob));
      
      setLoading(false);
    } catch (err) {
      console.error("[DocsEditorPage] Load error:", err);
      setError(err instanceof Error ? err.message : "Failed to load document");
      setLoading(false);
    }
  }, [fileId, privateKey, metadataKey]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  const handleSave = async (newBlob: Blob) => {
    if (!fileId || !fileMeta || !privateKey || !metadataKey) return;

    try {
      // 1. Re-encrypt with the same DEK but a NEW IV (standard security practice)
      const dek = await decryptWithShareKey(fileMeta.encryptedDEK, privateKey);
      const newIv = crypto.getRandomValues(new Uint8Array(12));
      const arrayBuffer = await newBlob.arrayBuffer();
      const encryptedBuffer = await encryptFileWithDEK(arrayBuffer, dek as unknown as CryptoKey, newIv);
      const encryptedBlob = new Blob([encryptedBuffer], { type: "application/octet-stream" });

      // 2. Upload to the same key using a specialized upload flow
      // Instead of using UploadContext (which is for new files), we'll do a direct update
      const updateRes = await fetch(`/api/objects/${fileId}/update-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          size: encryptedBlob.size,
          iv: Buffer.from(newIv).toString("base64"),
        })
      });

      if (!updateRes.ok) throw new Error("Failed to get upload URL");
      const { uploadUrl } = await updateRes.json();

      // 3. PUT to B2
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        body: encryptedBlob,
        headers: { "Content-Type": "application/octet-stream" }
      });

      if (!putRes.ok) throw new Error("Failed to upload to storage");

      // 4. Complete the update on the server
      await fetch(`/api/objects/${fileId}/complete-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size: encryptedBlob.size })
      });

    } catch (err) {
      console.error("[DocsEditorPage] Save error:", err);
      throw err;
    }
  };

  const handleBack = () => {
    // If we're on a subdomain, redirecting back might be tricky
    // For now, just go to the main dashboard if possible or close tab
    window.location.href = process.env.NEXT_PUBLIC_APP_URL || "/dashboard/files";
  };

  if (!fileId) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <AlertCircle className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-sm font-medium">No file specified for editing.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center space-y-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <div className="flex flex-col items-center">
          <p className="text-sm font-semibold">Opening Document</p>
          <p className="text-xs text-muted-foreground italic">Decrypting locally for your privacy...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertCircle className="h-6 w-6 text-destructive" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Access Denied</h2>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">{error}</p>
        </div>
        <Button onClick={handleBack} variant="outline" size="sm">
          Go to Dashboard
        </Button>
      </div>
    );
  }

  if (blobUrl) {
    return (
      <DocxEditor 
        url={blobUrl} 
        name={decryptedName || "Untitled Document"} 
        onSave={handleSave}
        onBack={handleBack}
      />
    );
  }

  return null;
}

"use client";

// REMOVED: TipTap-based DocxEditor + the `lib/actions/docx.ts` server action
// (which base64-shipped document content to the server, breaking E2EE) and the
// officeparser/normalizer pipeline — replaced by BlockNote E2EE implementation.
// All document processing now happens client-side in <DocumentEditor/>; the
// server only ever stores ciphertext.

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useCrypto } from "@/contexts/CryptoContext";
import { decryptMetadataString } from "@/lib/crypto/fileEncryption";
import { fromB64, toB64 } from "@/lib/crypto/utils";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

// BlockNote must never be server-rendered.
const DocumentEditor = dynamic(
  () => import("@/components/editor/DocumentEditor"),
  {
    ssr: false,
    loading: () => <FullScreenLoader label="Loading editor" />,
  },
);

const IV_LENGTH = 12;

interface DocsFileMeta {
  url: string;
  encryptedName?: string | null;
  encryptedDEK: string;
  iv: string;
  contentType: string;
}

interface EditorData {
  /** [iv(12) | ciphertext] — the self-contained blob DocumentEditor expects. */
  encryptedBlob: ArrayBuffer;
  /** AES-GCM DEK with encrypt + decrypt usages. */
  cryptoKey: CryptoKey;
}

function FullScreenLoader({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center space-y-4">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <div className="flex flex-col items-center">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs italic text-muted-foreground">
          Decrypting locally for your privacy…
        </p>
      </div>
    </div>
  );
}

function DocsEditorInner() {
  const searchParams = useSearchParams();
  const fileId = searchParams.get("id");

  const { privateKey, metadataKey } = useCrypto();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorData, setEditorData] = useState<EditorData | null>(null);
  const [decryptedName, setDecryptedName] = useState<string>("");

  const loadFile = useCallback(async () => {
    if (!fileId || !privateKey || !metadataKey) return;

    try {
      setLoading(true);
      setError(null);

      // 1. Fetch metadata (opaque key + wrapped DEK + IV).
      const res = await fetch(`/api/objects/${fileId}`);
      if (!res.ok) throw new Error("File not found or access denied");
      const data = (await res.json()) as DocsFileMeta;

      // 2. Decrypt the filename (display only).
      if (data.encryptedName) {
        setDecryptedName(await decryptMetadataString(data.encryptedName, metadataKey));
      }

      // 3. Download the ciphertext.
      const downloadRes = await fetch(data.url);
      if (!downloadRes.ok) throw new Error("Failed to download file content");
      const ciphertext = await downloadRes.arrayBuffer();

      // 4. Unwrap the per-file DEK with the user's RSA private key.
      const rawDEK = await crypto.subtle.decrypt(
        { name: "RSA-OAEP" },
        privateKey,
        fromB64(data.encryptedDEK),
      );
      const dek = await crypto.subtle.importKey(
        "raw",
        rawDEK,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt", "encrypt"],
      );

      // 5. Bridge the storage format (ciphertext + separate IV) to the
      //    self-contained [iv | ciphertext] blob DocumentEditor decrypts.
      const ivBytes = fromB64(data.iv);
      const combined = new Uint8Array(ivBytes.byteLength + ciphertext.byteLength);
      combined.set(ivBytes, 0);
      combined.set(new Uint8Array(ciphertext), ivBytes.byteLength);

      setEditorData({ encryptedBlob: combined.buffer, cryptoKey: dek });
      setLoading(false);
    } catch (err) {
      // Note: never log buffers or keys. Generic message only.
      console.error("[DocsEditorPage] Load error:", err instanceof Error ? err.message : err);
      setError(err instanceof Error ? err.message : "Failed to load document");
      setLoading(false);
    }
  }, [fileId, privateKey, metadataKey]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  // Persist a freshly-encrypted blob. DocumentEditor hands us [newIv | ciphertext];
  // we split the IV back out to match the existing storage format. The DEK is
  // unchanged and a fresh IV is used on every save (generated in documentCrypto).
  const handleSave = useCallback(
    async (newEncryptedBlob: ArrayBuffer) => {
      if (!fileId) throw new Error("Missing file id");

      const bytes = new Uint8Array(newEncryptedBlob);
      const iv = bytes.slice(0, IV_LENGTH);
      const ciphertext = bytes.slice(IV_LENGTH);

      const res = await fetch(
        `/api/objects/${fileId}/update-content?iv=${encodeURIComponent(toB64(iv))}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: ciphertext,
        },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to save document");
      }
    },
    [fileId],
  );

  const handleBack = () => {
    window.location.href = process.env.NEXT_PUBLIC_APP_URL || "/dashboard/files";
  };

  if (!fileId) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <AlertCircle className="mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-sm font-medium">No file specified for editing.</p>
      </div>
    );
  }

  if (loading) {
    return <FullScreenLoader label="Opening document" />;
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center space-y-4 p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-6 w-6 text-destructive" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Access Denied</h2>
          <p className="mx-auto max-w-xs text-sm text-muted-foreground">{error}</p>
        </div>
        <Button onClick={handleBack} variant="outline" size="sm">
          Go to Dashboard
        </Button>
      </div>
    );
  }

  if (editorData) {
    return (
      <DocumentEditor
        encryptedBlob={editorData.encryptedBlob}
        cryptoKey={editorData.cryptoKey}
        onSave={handleSave}
        fileName={decryptedName || "Untitled Document"}
      />
    );
  }

  return null;
}

export default function DocsEditorPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<FullScreenLoader label="Opening document" />}>
      <DocsEditorInner />
    </Suspense>
  );
}

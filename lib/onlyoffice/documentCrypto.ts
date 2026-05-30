/**
 * lib/onlyoffice/documentCrypto.ts
 *
 * The E2EE I/O layer for the document editor. It is the *only* place the editor
 * touches the network, and it speaks Xenode's real on-disk format — NOT the
 * "prepend-IV" scheme: the AES-256-GCM DEK is RSA-OAEP-wrapped and the 12-byte
 * GCM IV is stored separately as base64 (see `lib/crypto/fileEncryption.ts`).
 *
 * Load:  GET /api/objects/[id] → unwrap DEK with the vault private key →
 *        download ciphertext → AES-GCM decrypt → plaintext ArrayBuffer.
 * Save:  fresh 12-byte IV → AES-GCM encrypt with the *same* DEK →
 *        POST /api/objects/[id]/update-content?iv=<base64>.
 *
 * Why reuse the same DEK on save: `update-content` rewrites only the blob + IV,
 * never the wrapped DEK. Re-encrypting under a new DEK would desync the stored
 * `encryptedDEK` and make the file permanently undecryptable.
 *
 * SECURITY CONTRACT (do not weaken):
 *   - The DEK is imported non-extractable and lives only in the returned
 *     {@link LoadedDocument}. Never serialize, log, or transmit it.
 *   - Plaintext bytes are returned to the caller in-memory only — never written
 *     to localStorage / sessionStorage / IndexedDB, never logged.
 *   - Nothing here ever sends plaintext off the device; only ciphertext is
 *     uploaded.
 */

import { fromB64, toB64 } from "@/lib/crypto/utils";
import {
  decryptFileWithDEK,
  decryptFileChunkedCombined,
  encryptFileWithDEK,
  decryptMetadataString,
} from "@/lib/crypto/fileEncryption";
import {
  DocumentDecryptError,
  isEditableFormat,
  resolveDocFormat,
  type DocFormat,
} from "./adapter";

/** The subset of GET /api/objects/[id] this layer relies on. */
interface ObjectMetadata {
  url: string;
  isEncrypted: boolean;
  encryptedDEK: string | null;
  iv: string | null;
  contentType: string;
  encryptedName: string | null;
  size: number;
  chunkSize: number | null;
  chunkCount: number | null;
  chunkIvs: string | null;
  /** Added to the GET route for last-write-wins conflict detection. */
  updatedAt?: string | null;
}

export interface LoadedDocument {
  /** Decrypted plaintext. In-memory only — never persist or log. */
  document: ArrayBuffer;
  /**
   * Unwrapped DEK (encrypt + decrypt usages), non-extractable. Held only so
   * {@link saveEncryptedDocument} can re-encrypt under the same key. Never
   * serialize, log, or transmit.
   */
  dek: CryptoKey;
  format: DocFormat;
  contentType: string;
  /** Decrypted display name, when a metadataKey was supplied. */
  fileName: string | null;
  editable: boolean;
  /** Server `updatedAt` at load time; the conflict-detection baseline. */
  baselineUpdatedAt: string | null;
}

export interface SaveResult {
  size: number;
  updatedAt: string | null;
}

async function fetchObjectMetadata(
  fileId: string,
  signal?: AbortSignal,
): Promise<ObjectMetadata> {
  const res = await fetch(`/api/objects/${fileId}`, {
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error || `Failed to load document (${res.status}).`);
  }
  return (await res.json()) as ObjectMetadata;
}

/**
 * Fetch + decrypt a document for editing. Throws {@link DocumentDecryptError}
 * when the DEK can't be unwrapped or the blob can't be decrypted (wrong key /
 * corrupted), and a plain Error for unsupported / non-editable shapes.
 */
export async function loadEncryptedDocument(args: {
  fileId: string;
  privateKey: CryptoKey;
  /**
   * Vault metadata key. When supplied, the encrypted filename is decrypted to
   * surface a display name for the editor title. Not used for format detection
   * (the stored `contentType` is authoritative there).
   */
  metadataKey?: CryptoKey | null;
  /** Optional override for the display name; otherwise decrypted from metadata. */
  fileName?: string | null;
  signal?: AbortSignal;
}): Promise<LoadedDocument> {
  const { fileId, privateKey, metadataKey, signal } = args;

  const meta = await fetchObjectMetadata(fileId, signal);

  // `contentType` stores the file's real MIME type (preserved as
  // originalContentType on upload), so it is authoritative for format detection.
  const format = resolveDocFormat(meta.contentType, args.fileName);
  if (!format) {
    throw new Error("This file type can't be opened in the document editor.");
  }

  // Decrypt the filename for the editor title — display only, never used for
  // format detection.
  let fileName = args.fileName ?? null;
  if (!fileName && metadataKey && meta.encryptedName) {
    const decryptedName = await decryptMetadataString(
      meta.encryptedName,
      metadataKey,
    );
    if (decryptedName && decryptedName.includes(".")) fileName = decryptedName;
  }

  if (!meta.isEncrypted || !meta.encryptedDEK) {
    throw new DocumentDecryptError(
      "This document isn't end-to-end encrypted and can't be edited here.",
    );
  }
  if (!meta.url) {
    // Chunked-media streaming shape (separate chunk objects) — not a document.
    throw new Error("This file isn't a single-blob document and can't be edited.");
  }

  // ── Unwrap the DEK with the vault private key (RSA-OAEP) ──────────────────
  let dek: CryptoKey;
  try {
    const rawDEK = await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      privateKey,
      fromB64(meta.encryptedDEK),
    );
    // encrypt + decrypt usages so the same key serves load and save. Never
    // extractable — we never export it again.
    dek = await crypto.subtle.importKey(
      "raw",
      rawDEK,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } catch {
    throw new DocumentDecryptError(
      "Couldn't unwrap this document's key with your vault. Wrong key or corrupted file.",
    );
  }

  // ── Download ciphertext from the presigned URL ────────────────────────────
  const ciphertextRes = await fetch(meta.url, { signal });
  if (!ciphertextRes.ok) {
    throw new Error(`Failed to download document (${ciphertextRes.status}).`);
  }
  const ciphertext = await ciphertextRes.arrayBuffer();

  // ── Decrypt (single-blob, or combined-blob with per-chunk IVs) ────────────
  try {
    let plaintextBlob: Blob;
    if (meta.chunkIvs && meta.chunkSize && meta.chunkCount) {
      plaintextBlob = await decryptFileChunkedCombined(
        ciphertext,
        null, // DEK already unwrapped — pass it directly below
        meta.chunkIvs,
        meta.chunkSize,
        meta.chunkCount,
        dek,
        meta.contentType,
      );
    } else {
      if (!meta.iv) {
        throw new DocumentDecryptError("Document is missing its encryption IV.");
      }
      plaintextBlob = await decryptFileWithDEK(
        ciphertext,
        dek,
        meta.iv,
        meta.contentType,
      );
    }

    return {
      document: await plaintextBlob.arrayBuffer(),
      dek,
      format,
      contentType: meta.contentType,
      fileName,
      editable: isEditableFormat(format),
      baselineUpdatedAt: meta.updatedAt ?? null,
    };
  } catch (err) {
    if (err instanceof DocumentDecryptError) throw err;
    throw new DocumentDecryptError();
  }
}

/**
 * Encrypt edited plaintext under the document's existing DEK with a fresh IV
 * and overwrite the stored blob. Returns the server's new size + updatedAt so
 * the caller can advance its conflict-detection baseline.
 */
export async function saveEncryptedDocument(args: {
  fileId: string;
  plaintext: ArrayBuffer;
  dek: CryptoKey;
  signal?: AbortSignal;
}): Promise<SaveResult> {
  const { fileId, plaintext, dek, signal } = args;

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await encryptFileWithDEK(plaintext, dek, iv);

  const query = new URLSearchParams({ iv: toB64(iv) });
  const res = await fetch(`/api/objects/${fileId}/update-content?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: ciphertext,
    signal,
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error || `Failed to save document (${res.status}).`);
  }

  const data = (await res.json()) as {
    object?: { size?: number; updatedAt?: string | null };
  };
  return {
    size: data.object?.size ?? plaintext.byteLength,
    updatedAt: data.object?.updatedAt ?? null,
  };
}

/**
 * Lightweight read of the server's current `updatedAt`, used by the auto-save
 * hook to detect a divergent remote write before overwriting (last-write-wins).
 */
export async function getRemoteUpdatedAt(
  fileId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const meta = await fetchObjectMetadata(fileId, signal);
  return meta.updatedAt ?? null;
}

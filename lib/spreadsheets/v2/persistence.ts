/**
 * lib/spreadsheets/v2/persistence.ts
 *
 * Binary E2EE persistence for personal / organization / team spreadsheets in
 * Sheets v2. Reuses the *exact* v1 key-unwrapping, baseline-protection,
 * revision, and update-content routes, but returns the original decrypted bytes
 * instead of a NormalizedWorkbook, and saves the caller-provided exported bytes.
 *
 * Ciphertext-only invariant: the server sees only `/api/objects/[id]` metadata,
 * opaque ciphertext downloads, and an encrypted update-content body. No
 * plaintext, file name, or cell data crosses the wire.
 */

import {
  decryptFileWithDEK,
  decryptMetadataString,
  encryptFileWithDEK,
} from "@/lib/crypto/fileEncryption";
import { fromB64, toB64 } from "@/lib/crypto/utils";
import { REVISION_HEADER } from "@/lib/storage/revisions";
import { isSupportedSpreadsheet, spreadsheetExtension } from "../types";
import { assertWorkbookSize } from "./limits";
import {
  BinaryConflictError,
  type BinaryPersistenceAdapter,
  type LoadedBinaryWorkbook,
  type SaveBinaryInput,
  type SaveBinaryResult,
  type SpreadsheetWorkspace,
} from "./types";

interface ObjectMetadata {
  encryptedDEK: string | null;
  encryptedName: string | null;
  encryptedContentType: string | null;
  contentType: string;
  iv: string | null;
  revision: number;
  isEncrypted: boolean;
  wrappedBy: "user" | "space" | null;
  spaceKeyWrapIv: string | null;
  canWrite: boolean;
  url?: string;
  chunkUrls?: string[];
  chunkSize?: number | null;
  chunkCount?: number | null;
  chunkIvs?: string | null;
}

export interface XenodeBinaryPersistenceOptions {
  fetch: typeof fetch;
  privateKey: CryptoKey;
  metadataKey: CryptoKey;
  workspace: SpreadsheetWorkspace;
  workspaceSpaceKey?: Uint8Array | null;
  workspaceMetadataKey?: CryptoKey | null;
  /** Separate so scoped API headers are never attached to signed B2 URLs. */
  storageFetch?: typeof fetch;
}

export class XenodeBinaryPersistenceAdapter implements BinaryPersistenceAdapter {
  constructor(private options: XenodeBinaryPersistenceOptions) {}

  private async unwrap(meta: ObjectMetadata): Promise<CryptoKey> {
    if (!meta.encryptedDEK) throw new Error("spreadsheet_key_missing");
    if (meta.wrappedBy === "space") {
      if (!this.options.workspaceSpaceKey || !meta.spaceKeyWrapIv) {
        throw new Error("workspace_key_locked");
      }
      const rawSpaceKey = this.options.workspaceSpaceKey.buffer.slice(
        this.options.workspaceSpaceKey.byteOffset,
        this.options.workspaceSpaceKey.byteOffset +
          this.options.workspaceSpaceKey.byteLength,
      ) as ArrayBuffer;
      const spaceKey = await crypto.subtle.importKey(
        "raw",
        rawSpaceKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["unwrapKey"],
      );
      return crypto.subtle.unwrapKey(
        "raw",
        fromB64(meta.encryptedDEK),
        spaceKey,
        { name: "AES-GCM", iv: fromB64(meta.spaceKeyWrapIv) },
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    }
    const raw = await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      this.options.privateKey,
      fromB64(meta.encryptedDEK),
    );
    return crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  async loadBinary(
    objectId: string,
    signal?: AbortSignal,
  ): Promise<LoadedBinaryWorkbook> {
    if (!/^[a-f\d]{24}$/i.test(objectId)) throw new Error("invalid_object_id");
    const response = await this.options.fetch(`/api/objects/${objectId}`, { signal });
    if (!response.ok) {
      throw new Error(
        response.status === 403 ? "spreadsheet_access_denied" : "spreadsheet_not_found",
      );
    }
    const meta = (await response.json()) as ObjectMetadata;
    if (!meta.isEncrypted || !meta.iv) throw new Error("encrypted_spreadsheet_required");

    const metadataKey = this.options.workspaceMetadataKey ?? this.options.metadataKey;
    const name = meta.encryptedName
      ? await decryptMetadataString(meta.encryptedName, metadataKey)
      : "Encrypted spreadsheet.xlsx";
    const contentType = meta.encryptedContentType
      ? await decryptMetadataString(meta.encryptedContentType, metadataKey)
      : meta.contentType;
    if (!isSupportedSpreadsheet(name, contentType)) {
      throw new Error("unsupported_spreadsheet_type");
    }

    // Pin the original as an immutable baseline before the first edit, exactly
    // as v1 does — reusing the same route keeps version history identical.
    if (meta.canWrite) {
      const baselineResponse = await this.options.fetch(
        `/api/objects/${objectId}/versions/baseline`,
        { method: "POST", signal },
      );
      if (!baselineResponse.ok) throw new Error("original_protection_failed");
    }

    if (meta.chunkUrls?.length || meta.chunkCount) {
      throw new Error("chunked_object_unsupported");
    }
    if (!meta.url) throw new Error("spreadsheet_download_failed");

    // The API only authorizes and signs the opaque B2 object key. Ciphertext
    // then travels directly from B2 to this browser; the Next.js server never
    // receives the file body.
    const storageFetch = this.options.storageFetch ?? fetch;
    const ciphertextResponse = await storageFetch(meta.url, { signal });
    if (!ciphertextResponse.ok) throw new Error("spreadsheet_download_failed");

    const dek = await this.unwrap(meta);
    const ciphertext = await ciphertextResponse.arrayBuffer();
    const plaintextBlob = await decryptFileWithDEK(ciphertext, dek, meta.iv, contentType);
    const bytes = new Uint8Array(await plaintextBlob.arrayBuffer());
    assertWorkbookSize(bytes.byteLength);

    return {
      objectId,
      name,
      contentType,
      extension: spreadsheetExtension(name) || "xlsx",
      revision: meta.revision ?? 0,
      readOnly: !meta.canWrite,
      workspace: this.options.workspace,
      bytes,
      dek,
    };
  }

  async saveBinary(input: SaveBinaryInput): Promise<SaveBinaryResult> {
    if (input.loaded.readOnly) throw new Error("spreadsheet_read_only");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = input.bytes.slice().buffer;
    const ciphertext = await encryptFileWithDEK(plaintext, input.loaded.dek, iv);
    const response = await this.options.fetch(
      `/api/objects/${input.loaded.objectId}/update-content?iv=${encodeURIComponent(toB64(iv))}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          [REVISION_HEADER]: String(input.loaded.revision),
        },
        body: ciphertext,
        signal: input.signal,
      },
    );
    const body = await response.json().catch(() => ({}));
    if (response.status === 409) throw new BinaryConflictError(body.revision);
    if (!response.ok) throw new Error(body.code || "spreadsheet_save_failed");
    return {
      revision: body.revision ?? input.loaded.revision + 1,
      savedAt: new Date().toISOString(),
    };
  }
}

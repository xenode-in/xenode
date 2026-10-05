/**
 * lib/office-editor/persistence.ts
 *
 * Binary E2EE persistence for personal / organization / team spreadsheets in
 * the Office editor. Reuses the established key-unwrapping, baseline-protection,
 * revision, and update-content routes, but returns the original decrypted bytes
 * instead of a NormalizedWorkbook, and saves the caller-provided exported bytes.
 *
 * Ciphertext-only invariant: the server sees only `/api/objects/[id]` metadata,
 * direct B2 ciphertext transfer and JSON revision control requests. No
 * plaintext, file name, or cell data crosses the wire.
 */

import {
  decryptFileContent,
  decryptMetadataString,
  encryptFileRevision,
  unwrapSpaceFileKey,
  unwrapUserFileKey,
} from "@/lib/crypto/fileEncryption";
import { RevisionUploadError, uploadRevisionCiphertext } from "@xenode/upload-engine";
import {
  isSupportedSpreadsheet,
  spreadsheetExtension,
} from "@/lib/spreadsheets/types";
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
  spaceId: string;
  encryptedDEK: string | null;
  encryptedName: string | null;
  encryptedContentType: string | null;
  contentType: string;
  iv: string | null;
  revision: number;
  isEncrypted: boolean;
  wrappedBy: "user" | "space" | null;
  spaceKeyVersion?: number | null;
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
  /** Workspace key version a record was created with (workspace scope only). */
  workspaceKeyFor?: (
    version: number | null | undefined,
  ) => Promise<{ rawKey: Uint8Array; metadataKey: CryptoKey } | null>;
  /** Separate so scoped API headers are never attached to signed B2 URLs. */
  storageFetch?: typeof fetch;
}

export class XenodeBinaryPersistenceAdapter implements BinaryPersistenceAdapter {
  constructor(private options: XenodeBinaryPersistenceOptions) {}

  /** The file key is wrapped bound to this object; revisions reuse it. */
  private async unwrap(
    objectId: string,
    meta: ObjectMetadata,
    workspaceKey: { rawKey: Uint8Array } | null,
  ): Promise<CryptoKey> {
    if (!meta.encryptedDEK) throw new Error("spreadsheet_key_missing");
    if (meta.wrappedBy === "space") {
      if (!workspaceKey || !meta.spaceKeyWrapIv || !meta.spaceKeyVersion) {
        throw new Error("workspace_key_locked");
      }
      return unwrapSpaceFileKey(meta.encryptedDEK, meta.spaceKeyWrapIv, workspaceKey.rawKey, {
        fileId: objectId,
        spaceId: meta.spaceId,
        spaceKeyVersion: meta.spaceKeyVersion,
      });
    }
    return unwrapUserFileKey(meta.encryptedDEK, this.options.privateKey, objectId);
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

    // A workspace record uses the key version it was created with.
    const workspaceKey = meta.wrappedBy === "space"
      ? ((await this.options.workspaceKeyFor?.(meta.spaceKeyVersion)) ?? null)
      : null;
    if (meta.wrappedBy === "space" && !workspaceKey) throw new Error("workspace_key_locked");
    const metadataKey = workspaceKey?.metadataKey ?? this.options.metadataKey;
    const name = meta.encryptedName
      ? await decryptMetadataString(meta.encryptedName, metadataKey, { fileId: objectId, purpose: "name" })
      : "Encrypted spreadsheet.xlsx";
    const contentType = meta.encryptedContentType
      ? await decryptMetadataString(meta.encryptedContentType, metadataKey, { fileId: objectId, purpose: "content-type" })
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

    const dek = await this.unwrap(objectId, meta, workspaceKey);
    const ciphertext = await ciphertextResponse.arrayBuffer();
    const plaintextBlob = await decryptFileContent(ciphertext, dek, { iv: meta.iv }, objectId, contentType);
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
    const { ciphertext, iv } = await encryptFileRevision(
      input.bytes.slice().buffer,
      input.loaded.dek,
      input.loaded.objectId,
    );
    let result;
    try {
      result = await uploadRevisionCiphertext({
        endpoint: `/api/objects/${input.loaded.objectId}/update-content`, baseRevision: input.loaded.revision,
        iv, ciphertext, apiFetch: this.options.fetch,
        storageFetch: this.options.storageFetch ?? fetch, signal: input.signal,
      });
    } catch (error) {
      if (error instanceof RevisionUploadError && error.code === "revision_conflict") {
        throw new BinaryConflictError(error.revision ?? input.loaded.revision);
      }
      throw error;
    }
    return {
      revision: result.revision,
      savedAt: new Date().toISOString(),
    };
  }
}

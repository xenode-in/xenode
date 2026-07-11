import { decryptFileWithDEK, decryptMetadataString, encryptFileWithDEK } from "@/lib/crypto/fileEncryption";
import { fromB64, toB64 } from "@/lib/crypto/utils";
import { REVISION_HEADER } from "@/lib/storage/revisions";
import type { LoadedWorkbook, SaveWorkbookInput, SaveWorkbookResult, SpreadsheetPersistenceAdapter, SpreadsheetWorkspace } from "./types";
import { isSupportedSpreadsheet } from "./types";
import { SpreadsheetWorkerClient } from "./workerClient";

interface ObjectMetadata {
  encryptedDEK: string | null; encryptedName: string | null; encryptedContentType: string | null;
  contentType: string; iv: string | null; revision: number; isEncrypted: boolean;
  wrappedBy: "user" | "space" | null; spaceKeyWrapIv: string | null; canWrite: boolean;
}
export interface XenodeSpreadsheetPersistenceOptions {
  fetch: typeof fetch;
  privateKey: CryptoKey;
  metadataKey: CryptoKey;
  workspace: SpreadsheetWorkspace;
  workspaceSpaceKey?: Uint8Array | null;
  workspaceMetadataKey?: CryptoKey | null;
  worker?: SpreadsheetWorkerClient;
}
export class SpreadsheetConflictError extends Error {
  constructor(public readonly latestRevision?: number) { super("A newer encrypted revision is already stored."); this.name = "SpreadsheetConflictError"; }
}

export class XenodeSpreadsheetPersistenceAdapter implements SpreadsheetPersistenceAdapter {
  private worker: SpreadsheetWorkerClient;
  constructor(private options: XenodeSpreadsheetPersistenceOptions) { this.worker = options.worker ?? new SpreadsheetWorkerClient(); }
  private async unwrap(meta: ObjectMetadata): Promise<CryptoKey> {
    if (!meta.encryptedDEK) throw new Error("spreadsheet_key_missing");
    if (meta.wrappedBy === "space") {
      if (!this.options.workspaceSpaceKey || !meta.spaceKeyWrapIv) throw new Error("workspace_key_locked");
      const rawSpaceKey = this.options.workspaceSpaceKey.buffer.slice(
        this.options.workspaceSpaceKey.byteOffset,
        this.options.workspaceSpaceKey.byteOffset + this.options.workspaceSpaceKey.byteLength,
      ) as ArrayBuffer;
      const spaceKey = await crypto.subtle.importKey("raw", rawSpaceKey, { name: "AES-GCM", length: 256 }, false, ["unwrapKey"]);
      return crypto.subtle.unwrapKey("raw", fromB64(meta.encryptedDEK), spaceKey, { name: "AES-GCM", iv: fromB64(meta.spaceKeyWrapIv) }, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    }
    const raw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, this.options.privateKey, fromB64(meta.encryptedDEK));
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async load(objectId: string, signal?: AbortSignal): Promise<LoadedWorkbook> {
    if (!/^[a-f\d]{24}$/i.test(objectId)) throw new Error("invalid_object_id");
    const response = await this.options.fetch(`/api/objects/${objectId}`, { signal });
    if (!response.ok) throw new Error(response.status === 403 ? "spreadsheet_access_denied" : "spreadsheet_not_found");
    const meta = await response.json() as ObjectMetadata;
    if (!meta.isEncrypted || !meta.iv) throw new Error("encrypted_spreadsheet_required");
    const metadataKey = this.options.workspaceMetadataKey ?? this.options.metadataKey;
    const name = meta.encryptedName ? await decryptMetadataString(meta.encryptedName, metadataKey) : "Encrypted spreadsheet.xlsx";
    const contentType = meta.encryptedContentType ? await decryptMetadataString(meta.encryptedContentType, metadataKey) : meta.contentType;
    if (!isSupportedSpreadsheet(name, contentType)) throw new Error("unsupported_spreadsheet_type");
    if (meta.canWrite) {
      const baselineResponse = await this.options.fetch(
        "/api/objects/" + objectId + "/versions/baseline",
        { method: "POST", signal },
      );
      if (!baselineResponse.ok) throw new Error("original_protection_failed");
    }
    const ciphertextResponse = await this.options.fetch(`/api/objects/${objectId}/content`, { signal });
    if (!ciphertextResponse.ok) throw new Error("spreadsheet_download_failed");
    const dek = await this.unwrap(meta);
    const ciphertext = await ciphertextResponse.arrayBuffer();
    const plaintextBlob = await decryptFileWithDEK(ciphertext, dek, meta.iv, contentType);
    const { workbook, compatibility } = await this.worker.parse(await plaintextBlob.arrayBuffer(), signal);
    return { objectId, name, contentType, revision: meta.revision ?? 0, readOnly: !meta.canWrite, workspace: this.options.workspace, workbook, compatibility, dek };
  }
  async save(input: SaveWorkbookInput): Promise<SaveWorkbookResult> {
    if (input.loaded.readOnly) throw new Error("spreadsheet_read_only");
    const xlsx = await this.worker.export(input.workbook, input.signal);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await encryptFileWithDEK(xlsx, input.loaded.dek, iv);
    const response = await this.options.fetch(`/api/objects/${input.loaded.objectId}/update-content?iv=${encodeURIComponent(toB64(iv))}`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", [REVISION_HEADER]: String(input.loaded.revision) }, body: ciphertext, signal: input.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 409) throw new SpreadsheetConflictError(body.revision);
    if (!response.ok) throw new Error(body.code || "spreadsheet_save_failed");
    return { revision: body.revision ?? input.loaded.revision + 1, savedAt: new Date().toISOString() };
  }
  dispose() { this.worker.dispose(); }
}


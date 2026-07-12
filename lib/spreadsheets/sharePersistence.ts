import { buildDek, buildShareKey } from "@/lib/crypto/directShare";
import { decryptFileWithDEK, decryptWithShareKey, encryptFileWithDEK } from "@/lib/crypto/fileEncryption";
import { canEdit, normalizeShareRole } from "@/lib/orgs/shareRoles";
import { REVISION_HEADER } from "@/lib/storage/revisions";
import { SpreadsheetConflictError } from "./persistence";
import type { LoadedWorkbook, SaveWorkbookInput, SaveWorkbookResult, SpreadsheetPersistenceAdapter } from "./types";
import { isSupportedSpreadsheet } from "./types";
import { SpreadsheetWorkerClient } from "./workerClient";
import { toB64 } from "@/lib/crypto/utils";

interface ShareMetadata {
  _id: string;
  objectId: {
    _id: string;
    key: string;
    contentType: string;
    isEncrypted: boolean;
    mediaCategory?: string;
    iv?: string | null;
    revision?: number;
  } | null;
  shareEncryptedDEK?: string;
  shareKeyIv?: string;
  shareEncryptedName?: string;
  shareEncryptedContentType?: string;
  recipient?: { wrappedShareKey?: string; accessType?: string };
  role?: string;
}

export interface DirectSharePersistenceOptions {
  shareId: string;
  privateKey: CryptoKey;
  worker?: SpreadsheetWorkerClient;
}

/**
 * Persistence adapter for spreadsheets opened through a DirectShare. Loads via
 * the recipient's share-key chain (wrappedShareKey → share key → DEK) instead
 * of the owner/org object routes, and saves through the share-authorized
 * /api/direct-shares/[id]/update-content endpoint (editor role only).
 */
export class DirectShareSpreadsheetPersistenceAdapter implements SpreadsheetPersistenceAdapter {
  private worker: SpreadsheetWorkerClient;
  constructor(private options: DirectSharePersistenceOptions) {
    this.worker = options.worker ?? new SpreadsheetWorkerClient();
  }

  async load(_objectId: string, signal?: AbortSignal): Promise<LoadedWorkbook> {
    const { shareId, privateKey } = this.options;
    const response = await fetch(`/api/direct-shares/${shareId}`, { signal });
    if (!response.ok) {
      throw new Error(response.status === 403 ? "spreadsheet_access_denied" : "spreadsheet_not_found");
    }
    const meta = (await response.json()) as ShareMetadata;
    const object = meta.objectId;
    if (!object) throw new Error("spreadsheet_not_found");
    if (!object.isEncrypted || !object.iv) throw new Error("encrypted_spreadsheet_required");
    const wrappedShareKey = meta.recipient?.wrappedShareKey;
    if (!wrappedShareKey || !meta.shareEncryptedDEK || !meta.shareKeyIv) {
      throw new Error("spreadsheet_key_missing");
    }

    const shareKey = await buildShareKey(wrappedShareKey, privateKey);
    const fallbackName = object.key.split("/").pop() ?? "Shared spreadsheet.xlsx";
    const name = meta.shareEncryptedName
      ? await decryptWithShareKey(meta.shareEncryptedName, shareKey).catch(() => fallbackName)
      : fallbackName;
    const contentType = meta.shareEncryptedContentType
      ? await decryptWithShareKey(meta.shareEncryptedContentType, shareKey).catch(() => object.contentType)
      : object.contentType;
    if (!isSupportedSpreadsheet(name, contentType)) throw new Error("unsupported_spreadsheet_type");

    const role = normalizeShareRole(meta.role ?? meta.recipient?.accessType);
    const dek = await buildDek(shareKey, meta.shareEncryptedDEK, meta.shareKeyIv, ["encrypt", "decrypt"]);

    const streamResponse = await fetch(`/api/direct-shares/${shareId}/stream`, { method: "POST", signal });
    if (!streamResponse.ok) throw new Error("spreadsheet_download_failed");
    const stream = await streamResponse.json();
    if (stream.chunkUrls?.length) throw new Error("chunked_object_unsupported");
    if (!stream.streamUrl) throw new Error("spreadsheet_download_failed");
    const ciphertextResponse = await fetch(stream.streamUrl, { signal });
    if (!ciphertextResponse.ok) throw new Error("spreadsheet_download_failed");
    const ciphertext = await ciphertextResponse.arrayBuffer();
    const plaintextBlob = await decryptFileWithDEK(ciphertext, dek, object.iv, contentType);
    const { workbook, compatibility } = await this.worker.parse(await plaintextBlob.arrayBuffer(), signal);

    // No baseline pin here: recipients cannot reach /api/objects/[id]/versions,
    // and the update-content excel branch pins the original on first save.
    return {
      objectId: String(object._id),
      name,
      contentType,
      revision: object.revision ?? 0,
      readOnly: !canEdit(role),
      // Distinct workspaceId keeps IndexedDB drafts/recents isolated per share.
      workspace: { type: "personal", workspaceId: `ws_share_${shareId}` },
      workbook,
      compatibility,
      dek,
      share: { shareId, role },
    };
  }

  async save(input: SaveWorkbookInput): Promise<SaveWorkbookResult> {
    if (input.loaded.readOnly) throw new Error("spreadsheet_read_only");
    const xlsx = await this.worker.export(input.workbook, input.signal);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await encryptFileWithDEK(xlsx, input.loaded.dek, iv);
    const response = await fetch(
      `/api/direct-shares/${this.options.shareId}/update-content?iv=${encodeURIComponent(toB64(iv))}`,
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
    if (response.status === 409) throw new SpreadsheetConflictError(body.revision);
    if (!response.ok) throw new Error(body.code || "spreadsheet_save_failed");
    return { revision: body.revision ?? input.loaded.revision + 1, savedAt: new Date().toISOString() };
  }

  dispose() {
    this.worker.dispose();
  }
}

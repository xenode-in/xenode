import { NonRetryableUploadError } from "./errors";
import { validateUploadRecord, type UploadRecord, type UploadJournalScope } from "./journal";

export interface UploadResumeTransport {
  /** Must bind account/session and the exact Space; API calls never use bare fetch. */
  request(path: string, init?: RequestInit): Promise<Response>;
  put(body: Blob, url: () => string, refresh: () => Promise<void>, onProgress?: (loaded: number) => void): Promise<void>;
  checkActive(): void;
}
export interface ResumeOptions {
  currentSpaceKeyVersion: number | null;
  onProgress?: (percent: number) => void;
  onChunkComplete?: (index: number) => Promise<void>;
}

async function json(transport: UploadResumeTransport, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  transport.checkActive();
  const response = await transport.request(path, init);
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  transport.checkActive();
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : "Could not resume upload";
    if ([400, 403, 404, 409].includes(response.status)) throw new NonRetryableUploadError(message);
    throw new Error(message);
  }
  return data;
}
const post = (body: unknown): RequestInit => ({
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
export function validateUploadReservation(data: Record<string, unknown>, record: {
  spaceId: string; bucketId: string; sessionId?: string; fileId?: string;
}) {
  if ((record.sessionId !== undefined && data.sessionId !== record.sessionId) ||
    data.spaceId !== record.spaceId || data.bucketId !== record.bucketId ||
    (record.fileId !== undefined && (data.fileId ?? data.objectKey) !== record.fileId)) {
    throw new NonRetryableUploadError("Upload reservation identity changed");
  }
}
function url(data: Record<string, unknown>): string {
  if (typeof data.uploadUrl !== "string" || !/^https:\/\//u.test(data.uploadUrl)) {
    throw new NonRetryableUploadError("Invalid ciphertext upload URL");
  }
  return data.uploadUrl;
}

/** One immutable ciphertext job, status checked against its exact reservation. */
export async function resumeUploadRecord(record: UploadRecord, scope: UploadJournalScope,
  transport: UploadResumeTransport, options: ResumeOptions): Promise<unknown> {
  validateUploadRecord(record, scope);
  if (!record.mainBytes || !record.bytesPersisted) throw new NonRetryableUploadError("Upload bytes unavailable; re-upload the file");
  transport.checkActive();
  const present = new Map<string, number>();
  let offset = 0;
  let completed = false;
  do {
    const status = await json(transport, `/api/objects/upload-status?bucketId=${encodeURIComponent(record.bucketId)}&sessionId=${encodeURIComponent(record.sessionId)}&offset=${offset}`);
    validateUploadReservation(status, record);
    completed = status.completed === true;
    if (!Array.isArray(status.objects)) throw new NonRetryableUploadError("Invalid upload status");
    for (const value of status.objects) {
      const item = value as { key?: unknown; size?: unknown };
      if (typeof item?.key !== "string" || !Number.isSafeInteger(item.size) || (item.size as number) < 1) {
        throw new NonRetryableUploadError("Invalid stored ciphertext size");
      }
      present.set(item.key, item.size as number);
    }
    if (status.nextOffset === null) break;
    if (!Number.isSafeInteger(status.nextOffset) || (status.nextOffset as number) <= offset || (status.nextOffset as number) > 4099) {
      throw new NonRetryableUploadError("Invalid upload status cursor");
    }
    offset = status.nextOffset as number;
  } while (!completed);

  if (!completed && record.wrappedBy === "space" && record.spaceKeyVersion !== options.currentSpaceKeyVersion) {
    throw new NonRetryableUploadError("Workspace keys changed; re-upload this file");
  }
  const exists = (key: string, size: number) => {
    const actual = present.get(key);
    if (actual === undefined) return false;
    if (actual !== size) throw new NonRetryableUploadError("Stored ciphertext size differs; this key cannot be overwritten");
    return true;
  };
  const total = record.mainBytes.size;
  const chunks = record.isChunked ? Array.from({ length: record.chunkCount! }, (_, index) => {
    const size = Math.min(record.cipherChunkSize!, total - index * record.cipherChunkSize!);
    if (size < 16) throw new NonRetryableUploadError("Invalid persisted chunk layout");
    return { index, key: `${record.fileId}-chunk-${index}`, size };
  }) : undefined;
  let uploaded = 0;
  const progress = () => options.onProgress?.(Math.min(100, Math.round(uploaded / total * 100)));
  if (!completed) {
    if (chunks) {
      const reserve = async () => {
        const data = await json(transport, "/api/objects/presign-upload-multipart", post({
          fileSize: total, fileType: record.uploadContentType, bucketId: record.bucketId,
          sessionId: record.sessionId, chunkCount: record.chunkCount, chunkSize: record.chunkSize,
        }));
        validateUploadReservation(data, record);
        if (data.chunkSize !== record.chunkSize || !Array.isArray(data.urls) || data.urls.length !== chunks.length) {
          throw new NonRetryableUploadError("Upload chunk layout changed");
        }
        const urls = data.urls as { index: number; key: string; url: string }[];
        for (const chunk of chunks) {
          const entry = urls[chunk.index];
          if (entry?.index !== chunk.index || entry.key !== chunk.key || !/^https:\/\//u.test(entry.url)) {
            throw new NonRetryableUploadError("Upload chunk identity changed");
          }
        }
        return urls;
      };
      let urls = await reserve();
      const loaded = new Array<number>(chunks.length).fill(0);
      let next = 0;
      const worker = async () => {
        while (next < chunks.length) {
          const chunk = chunks[next++];
          transport.checkActive();
          if (!exists(chunk.key, chunk.size)) {
            const start = chunk.index * record.cipherChunkSize!;
            await transport.put(record.mainBytes!.slice(start, start + chunk.size),
              () => urls[chunk.index].url, async () => { urls = await reserve(); },
              (size) => { loaded[chunk.index] = size; options.onProgress?.(Math.round(loaded.reduce((sum, n) => sum + n, 0) / total * 100)); });
            transport.checkActive();
          }
          loaded[chunk.index] = chunk.size;
          await options.onChunkComplete?.(chunk.index);
          options.onProgress?.(Math.round(loaded.reduce((sum, n) => sum + n, 0) / total * 100));
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, worker));
    } else if (!exists(record.fileId, total)) {
      const reserve = async () => {
        const data = await json(transport, "/api/objects/presign-upload", post({
          fileSize: total, fileType: record.uploadContentType, bucketId: record.bucketId, sessionId: record.sessionId,
        }));
        validateUploadReservation(data, record);
        return url(data);
      };
      let signedUrl = await reserve();
      await transport.put(record.mainBytes, () => signedUrl, async () => { signedUrl = await reserve(); },
        (size) => { uploaded = size; progress(); });
      transport.checkActive();
    }
  }

  const variant = async (kind: "thumbnail" | "optimized", bytes: Blob, expectedKey: string) => {
    if (completed || exists(expectedKey, bytes.size)) return;
    const reserve = async () => {
      const data = await json(transport, "/api/objects/presign-upload", post({
        fileSize: bytes.size, fileType: "application/octet-stream", bucketId: record.bucketId,
        parentSessionId: record.sessionId, variant: kind,
      }));
      if (data.objectKey !== expectedKey || data.bucketId !== record.bucketId || data.spaceId !== record.spaceId ||
        data.sessionId !== record.sessionId) throw new NonRetryableUploadError("Upload variant identity changed");
      return url(data);
    };
    let signedUrl = await reserve();
    await transport.put(bytes, () => signedUrl, async () => { signedUrl = await reserve(); });
    transport.checkActive();
  };
  const thumbnailKey = record.thumbnailKey ?? (record.thumbnail ? `${record.fileId}-thumb` : undefined);
  if (thumbnailKey && record.thumbnail && record.thumbnail !== thumbnailKey) {
    await variant("thumbnail", new Blob([record.thumbnail], { type: "application/octet-stream" }), thumbnailKey);
  }
  if (record.optimizedBytes && record.optimizedKey) await variant("optimized", record.optimizedBytes, record.optimizedKey);

  const response = await json(transport, "/api/objects/complete-upload", post({
    objectKey: record.fileId, bucketId: record.bucketId, sessionId: record.sessionId, folderId: record.folderId,
    size: total, contentType: record.uploadContentType, originalContentType: record.type,
    mediaCategory: record.mediaCategory, isEncrypted: true, encryptedDEK: record.encryptedDEK,
    encryptedName: record.encryptedName, encryptedContentType: record.encryptedContentType,
    encryptedMetadata: record.encryptedMetadata, wrappedBy: record.wrappedBy,
    spaceKeyVersion: record.spaceKeyVersion, spaceKeyWrapIv: record.spaceKeyWrapIv, iv: record.iv,
    isChunked: record.isChunked, chunkSize: record.chunkSize, chunkCount: record.chunkCount,
    chunkIvs: record.chunkIvs, chunks, thumbnail: thumbnailKey, optimizedKey: record.optimizedKey,
    optimizedSize: record.optimizedSize, optimizedContentType: record.optimizedContentType,
    optimizedIV: record.optimizedIV, optimizedEncryptedDEK: record.optimizedEncryptedDEK,
    optimizedSpaceKeyWrapIv: record.optimizedSpaceKeyWrapIv, aspectRatio: record.aspectRatio,
  }));
  const object = response.object as { _id?: unknown; spaceId?: unknown; key?: unknown } | undefined;
  if (object?._id !== record.sessionId || object.spaceId !== record.spaceId || object.key !== record.fileId) {
    throw new NonRetryableUploadError("Completed upload identity changed");
  }
  transport.checkActive();
  options.onProgress?.(100);
  return response.object;
}

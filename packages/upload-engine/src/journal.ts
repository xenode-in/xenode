import { openEnvelopeWithKey, sealEnvelopeWithKey, utf8, encodeBase64Url,
  type CryptoEnvelope, type EnvelopeContext } from "@xenode/crypto-core";

export const UPLOAD_JOURNAL_VERSION = 1 as const;
export const RESUME_BYTE_CAP = 250 * 1024 * 1024;
const HASH_PART_BYTES = 4 * 1024 * 1024;
const MAX_METADATA_BYTES = 8 * 1024 * 1024;

export interface UploadJournalScope {
  accountId: string;
  productId: "drive" | "photos";
  spaceId: string;
  wrappedBy: "user" | "space";
  spaceKeyVersion: number | null;
}

/** Decrypted only in memory after the matching product/Space is unlocked. */
export interface UploadRecord {
  id: string;
  userId: string;
  spaceId: string;
  wrappedBy: "user" | "space";
  spaceKeyVersion?: number;
  spaceKeyWrapIv?: string;
  status: "uploading" | "paused" | "failed";
  createdAt: number;
  fileName: string;
  size: number;
  type: string;
  mediaCategory: string;
  bucketId: string;
  folderId: string | null;
  aspectRatio?: number;
  isChunked: boolean;
  isEncrypted: true;
  fileId: string;
  sessionId: string;
  uploadContentType: string;
  encryptedDEK: string;
  iv?: string;
  chunkSize?: number;
  cipherChunkSize?: number;
  chunkCount?: number;
  chunkIvs?: string;
  completedChunks: number[];
  encryptedName: string;
  encryptedContentType?: string;
  encryptedMetadata?: string;
  thumbnail?: string;
  thumbnailKey?: string;
  optimizedKey?: string;
  optimizedIV?: string;
  optimizedEncryptedDEK?: string;
  optimizedSpaceKeyWrapIv?: string;
  optimizedSize?: number;
  optimizedContentType?: string;
  bytesPersisted: boolean;
  mainBytes?: Blob;
  optimizedBytes?: Blob;
}

export interface SealedUploadRecord {
  version: typeof UPLOAD_JOURNAL_VERSION;
  id: string;
  scope: UploadJournalScope;
  revision: number;
  createdAt: number;
  envelope: CryptoEnvelope;
  mainBytes?: Blob;
  optimizedBytes?: Blob;
}

interface Payload {
  record: Omit<UploadRecord, "mainBytes" | "optimizedBytes">;
  mainDigest: string | null;
  optimizedDigest: string | null;
}

/** insert/CAS/remove must be atomic; cryptography runs outside IDB transactions. */
export interface UploadJournalStorage {
  get(id: string): Promise<SealedUploadRecord | undefined>;
  list(scope: UploadJournalScope): Promise<SealedUploadRecord[]>;
  insert(row: SealedUploadRecord): Promise<void>;
  compareAndSwap(previous: SealedUploadRecord, next: SealedUploadRecord): Promise<boolean>;
  remove(id: string, scope: UploadJournalScope): Promise<void>;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f]/u.test(value);
}
function sealedText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_METADATA_BYTES;
}
export function sameUploadScope(left: UploadJournalScope, right: UploadJournalScope): boolean {
  return left.accountId === right.accountId && left.productId === right.productId && left.spaceId === right.spaceId &&
    left.wrappedBy === right.wrappedBy && left.spaceKeyVersion === right.spaceKeyVersion;
}
function context(row: Pick<SealedUploadRecord, "id" | "scope" | "revision">): EnvelopeContext {
  const { scope } = row;
  if (!validId(row.id) || !validId(scope.accountId) || !validId(scope.spaceId) ||
    !["drive", "photos"].includes(scope.productId) || !["user", "space"].includes(scope.wrappedBy) ||
    (scope.wrappedBy === "user" ? scope.spaceKeyVersion !== null :
      !Number.isSafeInteger(scope.spaceKeyVersion) || scope.spaceKeyVersion! < 1) ||
    !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error("Invalid upload journal binding");
  return { accountId: scope.accountId, productId: scope.productId, spaceId: scope.spaceId,
    type: "upload-journal", keyVersion: scope.spaceKeyVersion ?? 1,
    keyId: JSON.stringify(["upload-journal", UPLOAD_JOURNAL_VERSION, row.id, scope.wrappedBy, row.revision]) };
}

export function validateUploadRecord(record: UploadRecord, scope: UploadJournalScope): void {
  if (!record || record.userId !== scope.accountId || record.spaceId !== scope.spaceId ||
    record.wrappedBy !== scope.wrappedBy || (record.spaceKeyVersion ?? null) !== scope.spaceKeyVersion ||
    !validId(record.id) || !validId(record.fileId) || !/^[a-f0-9]{24}$/iu.test(record.sessionId) ||
    !/^[a-f0-9]{24}$/iu.test(record.bucketId) || record.isEncrypted !== true ||
    !sealedText(record.encryptedDEK) || !sealedText(record.encryptedName) ||
    (record.wrappedBy === "space" && !validId(record.spaceKeyWrapIv)) ||
    !Number.isSafeInteger(record.size) || record.size < 0 || !Number.isSafeInteger(record.createdAt) ||
    record.createdAt < 0 || typeof record.fileName !== "string" || typeof record.type !== "string" ||
    record.uploadContentType !== "application/octet-stream" ||
    !["uploading", "paused", "failed"].includes(record.status)) throw new Error("Invalid encrypted upload journal record");
  const count = record.isChunked ? record.chunkCount : 1;
  if (!Number.isSafeInteger(count) || count! < 1 || count! > 4096 ||
    !Array.isArray(record.completedChunks) || new Set(record.completedChunks).size !== record.completedChunks.length ||
    record.completedChunks.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= count!)) {
    throw new Error("Invalid upload checkpoint");
  }
  if (record.isChunked) {
    let ivs: unknown;
    try { ivs = JSON.parse(record.chunkIvs ?? ""); } catch { throw new Error("Invalid upload chunk IVs"); }
    if (!Array.isArray(ivs) || ivs.length !== count || ivs.some((iv) => !validId(iv)) ||
      !Number.isSafeInteger(record.chunkSize) || record.chunkSize! < 1 ||
      record.cipherChunkSize !== record.chunkSize! + 16) throw new Error("Invalid upload chunk layout");
  } else if (!validId(record.iv)) throw new Error("Missing upload IV");
  if (record.optimizedKey && (!sealedText(record.optimizedEncryptedDEK) || !validId(record.optimizedIV) ||
    (record.wrappedBy === "space" && !validId(record.optimizedSpaceKeyWrapIv)))) {
    throw new Error("Missing optimized ciphertext key context");
  }
}

const METADATA_FIELDS = [
  "id", "userId", "spaceId", "wrappedBy", "spaceKeyVersion", "spaceKeyWrapIv", "status", "createdAt",
  "fileName", "size", "type", "mediaCategory", "bucketId", "folderId", "aspectRatio", "isChunked", "isEncrypted",
  "fileId", "sessionId", "uploadContentType", "encryptedDEK", "iv", "chunkSize", "cipherChunkSize", "chunkCount",
  "chunkIvs", "completedChunks", "encryptedName", "encryptedContentType", "encryptedMetadata", "thumbnail",
  "thumbnailKey", "optimizedKey", "optimizedIV", "optimizedEncryptedDEK", "optimizedSpaceKeyWrapIv",
  "optimizedSize", "optimizedContentType", "bytesPersisted",
] as const;

/** Bounded digest of the ordered ciphertext parts; never buffers a whole file. */
async function digest(blob: Blob | undefined): Promise<string | null> {
  if (!blob) return null;
  if (blob.size > RESUME_BYTE_CAP) throw new Error("Upload exceeds the journal byte cap");
  const parts: string[] = [];
  for (let offset = 0; offset < blob.size; offset += HASH_PART_BYTES) {
    parts.push(encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256",
      await blob.slice(offset, offset + HASH_PART_BYTES).arrayBuffer()))));
  }
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256",
    utf8(JSON.stringify(["xenode-upload-bytes/1", blob.size, parts])) as BufferSource)));
}

async function sealPayload(row: Omit<SealedUploadRecord, "envelope">, payload: Payload, key: CryptoKey) {
  const bytes = utf8(JSON.stringify(payload));
  if (bytes.length > MAX_METADATA_BYTES) throw new Error("Upload journal metadata is too large");
  try { return { ...row, envelope: await sealEnvelopeWithKey(bytes, key, context(row)) }; }
  finally { bytes.fill(0); }
}

async function openPayload(row: SealedUploadRecord, key: CryptoKey, scope: UploadJournalScope): Promise<Payload> {
  if (row.version !== UPLOAD_JOURNAL_VERSION || !sameUploadScope(row.scope, scope) ||
    typeof row.envelope?.ciphertext !== "string" || row.envelope.ciphertext.length > MAX_METADATA_BYTES * 2) {
    throw new Error("Upload journal scope or format mismatch");
  }
  const bytes = await openEnvelopeWithKey(row.envelope, key, context(row));
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Payload;
    validateUploadRecord(payload.record, scope);
    if (payload.record.id !== row.id || payload.record.createdAt !== row.createdAt ||
      (payload.mainDigest !== null && typeof payload.mainDigest !== "string") ||
      (payload.optimizedDigest !== null && typeof payload.optimizedDigest !== "string")) {
      throw new Error("Upload journal identity mismatch");
    }
    return payload;
  } finally { bytes.fill(0); }
}

export class UploadJournal {
  constructor(private readonly storage: UploadJournalStorage, readonly scope: UploadJournalScope,
    private readonly key: CryptoKey, private readonly isActive: () => boolean = () => true) {
    if (key.extractable || key.algorithm.name !== "AES-GCM" || (key.algorithm as AesKeyAlgorithm).length !== 256) {
      throw new Error("Upload journal key must be non-extractable AES-256");
    }
  }
  private check() { if (!this.isActive()) throw new Error("Upload encryption context is no longer active"); }
  async save(record: UploadRecord): Promise<void> {
    this.check();
    validateUploadRecord(record, this.scope);
    if (record.bytesPersisted !== Boolean(record.mainBytes) || (!record.bytesPersisted && record.optimizedBytes)) {
      throw new Error("Invalid persisted upload bytes");
    }
    const { mainBytes, optimizedBytes } = record;
    if ((mainBytes?.size ?? 0) + (optimizedBytes?.size ?? 0) > RESUME_BYTE_CAP) throw new Error("Upload exceeds the journal byte cap");
    // Never serialize caller extras (keys, capabilities or source File handles).
    const metadata = Object.fromEntries(METADATA_FIELDS.map((field) => [field, record[field]])
      .filter(([, value]) => value !== undefined)) as Payload["record"];
    const row = await sealPayload({ version: UPLOAD_JOURNAL_VERSION, id: record.id, scope: { ...this.scope },
      revision: 1, createdAt: record.createdAt, mainBytes, optimizedBytes },
    { record: metadata, mainDigest: await digest(mainBytes), optimizedDigest: await digest(optimizedBytes) }, this.key);
    this.check();
    await this.storage.insert(row);
  }
  async load(id: string): Promise<UploadRecord | undefined> {
    this.check();
    const row = await this.storage.get(id);
    if (!row) return undefined;
    const payload = await openPayload(row, this.key, this.scope);
    if (payload.mainDigest !== await digest(row.mainBytes) || payload.optimizedDigest !== await digest(row.optimizedBytes) ||
      payload.record.bytesPersisted !== Boolean(row.mainBytes)) throw new Error("Persisted upload ciphertext changed");
    this.check();
    return { ...payload.record, mainBytes: row.mainBytes, optimizedBytes: row.optimizedBytes };
  }
  async list(): Promise<UploadRecord[]> {
    this.check();
    const rows = await this.storage.list(this.scope);
    const records: UploadRecord[] = [];
    for (const row of rows) {
      const record = await this.load(row.id);
      if (record) records.push(record);
    }
    this.check();
    return records.sort((a, b) => a.createdAt - b.createdAt);
  }
  async markChunkComplete(id: string, index: number): Promise<void> {
    for (let attempt = 0; attempt < 32; attempt++) {
      this.check();
      const previous = await this.storage.get(id);
      if (!previous) return;
      const payload = await openPayload(previous, this.key, this.scope);
      const count = payload.record.isChunked ? payload.record.chunkCount! : 1;
      if (!Number.isSafeInteger(index) || index < 0 || index >= count) throw new Error("Invalid upload checkpoint index");
      if (payload.record.completedChunks.includes(index)) return;
      payload.record.completedChunks = [...payload.record.completedChunks, index].sort((a, b) => a - b);
      const next = await sealPayload({ ...previous, revision: previous.revision + 1 }, payload, this.key);
      this.check();
      if (await this.storage.compareAndSwap(previous, next)) return;
    }
    throw new Error("Upload checkpoint contention; retry later");
  }
  async remove(id: string): Promise<void> { this.check(); await this.storage.remove(id, this.scope); }
}

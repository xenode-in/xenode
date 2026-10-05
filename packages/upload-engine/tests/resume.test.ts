import { describe, expect, it } from "vitest";
import { resumeUploadRecord, type UploadRecord, type UploadJournalScope, type UploadResumeTransport } from "../src";

const scope: UploadJournalScope = { accountId: "one", productId: "drive", spaceId: "space_one",
  wrappedBy: "space", spaceKeyVersion: 2 };
function record(chunked = false): UploadRecord {
  return { id: "job_one", userId: "one", spaceId: scope.spaceId, wrappedBy: "space", spaceKeyVersion: 2,
    spaceKeyWrapIv: "wrapped_iv", status: "paused", createdAt: 1, fileName: "private-name.pdf",
    size: 4, type: "application/pdf", mediaCategory: "pdf", bucketId: "0123456789abcdef01234567",
    folderId: null, isChunked: chunked, isEncrypted: true, fileId: "opaque_file_key",
    sessionId: "1123456789abcdef01234567", uploadContentType: "application/octet-stream",
    encryptedDEK: "sealed_key", encryptedName: "sealed_name", iv: chunked ? undefined : "iv",
    chunkSize: chunked ? 2 : undefined, cipherChunkSize: chunked ? 18 : undefined,
    chunkCount: chunked ? 2 : undefined, chunkIvs: chunked ? JSON.stringify(["first_iv", "second_iv"]) : undefined,
    completedChunks: [], bytesPersisted: true, mainBytes: new Blob([new Uint8Array(chunked ? 36 : 20)]) };
}
function fixture(job = record()) {
  const calls: Array<{ path: string; body?: Record<string, unknown> }> = [];
  const puts: number[] = [];
  let completed = false;
  let statusOverride: Record<string, unknown> = {};
  let reserveOverride: Record<string, unknown> = {};
  let active = true;
  const identity = { spaceId: job.spaceId, bucketId: job.bucketId, sessionId: job.sessionId, fileId: job.fileId };
  const transport: UploadResumeTransport = {
    checkActive() { if (!active) throw new Error("locked"); },
    async request(path, init) {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      calls.push({ path, body });
      let data: unknown = {};
      if (path.startsWith("/api/objects/upload-status")) data = { ...identity, completed, objects: [], nextOffset: null, ...statusOverride };
      else if (path.endsWith("presign-upload-multipart")) data = { ...identity, chunkSize: job.chunkSize,
        urls: Array.from({ length: job.chunkCount! }, (_, index) => ({ index, key: `${job.fileId}-chunk-${index}`, url: `https://r2.test/part/${index}` })),
        ...reserveOverride };
      else if (path.endsWith("presign-upload")) data = { ...identity, objectKey: job.fileId, uploadUrl: "https://r2.test/main", ...reserveOverride };
      else if (path.endsWith("complete-upload")) data = { object: { _id: job.sessionId, spaceId: job.spaceId, key: job.fileId } };
      return Response.json(data);
    },
    async put(bytes) { puts.push(bytes.size); },
  };
  return { calls, puts, transport, scope, job, complete: () => { completed = true; },
    status: (value: Record<string, unknown>) => { statusOverride = value; },
    reserve: (value: Record<string, unknown>) => { reserveOverride = value; },
    lock: () => { active = false; } };
}

describe("immutable encrypted resume adapter", () => {
  it("finalizes a single workspace upload with its exact key and Space context", async () => {
    const f = fixture();
    await resumeUploadRecord(f.job, scope, f.transport, { currentSpaceKeyVersion: 2 });
    expect(f.puts).toEqual([20]);
    const completion = f.calls.at(-1)!.body!;
    expect(completion).toMatchObject({ sessionId: f.job.sessionId, objectKey: f.job.fileId,
      wrappedBy: "space", spaceKeyVersion: 2, spaceKeyWrapIv: "wrapped_iv" });
    expect(JSON.stringify(f.calls)).not.toContain(f.job.fileName);
  });
  it("uses server-verified chunks rather than trusting local completion hints", async () => {
    const f = fixture(record(true));
    f.job.completedChunks = [0, 1];
    f.status({ objects: [{ key: `${f.job.fileId}-chunk-0`, size: 18 }] });
    const checkpoints: number[] = [];
    await resumeUploadRecord(f.job, scope, f.transport, { currentSpaceKeyVersion: 2,
      onChunkComplete: async (index) => { checkpoints.push(index); } });
    expect(f.puts).toEqual([18]);
    expect(checkpoints.sort()).toEqual([0, 1]);
    expect(f.calls.at(-1)!.body).toMatchObject({ chunkIvs: f.job.chunkIvs, chunkCount: 2, size: 36 });
  });
  it.each(["spaceId", "sessionId", "bucketId", "fileId"])("refuses mismatched status %s before any PUT", async (field) => {
    const f = fixture();
    f.status({ [field]: "another" });
    await expect(resumeUploadRecord(f.job, scope, f.transport, { currentSpaceKeyVersion: 2 })).rejects.toThrow("identity changed");
    expect(f.puts).toEqual([]);
  });
  it("refuses a changed reservation identity on URL renewal", async () => {
    const f = fixture();
    f.reserve({ sessionId: "another" });
    await expect(resumeUploadRecord(f.job, scope, f.transport, { currentSpaceKeyVersion: 2 })).rejects.toThrow("identity changed");
    expect(f.puts).toEqual([]);
  });
  it("an occupied key with a wrong length never authorizes overwrite", async () => {
    const f = fixture();
    f.status({ objects: [{ key: f.job.fileId, size: 19 }] });
    await expect(resumeUploadRecord(f.job, scope, f.transport, { currentSpaceKeyVersion: 2 })).rejects.toThrow("cannot be overwritten");
    expect(f.puts).toEqual([]);
  });
  it("requires re-upload after rotation, before re-signing or PUT", async () => {
    const f = fixture();
    await expect(resumeUploadRecord(f.job, scope, f.transport, { currentSpaceKeyVersion: 3 })).rejects.toThrow("Workspace keys changed");
    expect(f.calls).toHaveLength(1);
    expect(f.puts).toEqual([]);
  });
  it("retries a completed reservation without PUT even after rotation", async () => {
    const f = fixture();
    f.complete();
    await resumeUploadRecord(f.job, scope, f.transport, { currentSpaceKeyVersion: 3 });
    expect(f.puts).toEqual([]);
    expect(f.calls.map((call) => call.path.split("?")[0])).toEqual(["/api/objects/upload-status", "/api/objects/complete-upload"]);
  });
  it("a lock prevents both status and transfer", async () => {
    const f = fixture();
    f.lock();
    await expect(resumeUploadRecord(f.job, scope, f.transport, { currentSpaceKeyVersion: 2 })).rejects.toThrow("locked");
    expect(f.calls).toEqual([]);
  });
  it("propagates failed server verification instead of falling back to local hints", async () => {
    const f = fixture();
    f.transport.request = async () => Response.json({ error: "Cannot verify storage" }, { status: 502 });
    await expect(resumeUploadRecord(f.job, scope, f.transport, { currentSpaceKeyVersion: 2 })).rejects.toThrow("Cannot verify");
    expect(f.puts).toEqual([]);
  });
});

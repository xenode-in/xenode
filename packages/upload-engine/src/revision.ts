export class RevisionUploadError extends Error {
  constructor(readonly code: string, readonly status: number, readonly revision?: number) {
    super(code);
    this.name = "RevisionUploadError";
  }
}

/** Separate control fetch from storage fetch so product headers never reach B2. */
export async function uploadRevisionCiphertext(input: {
  endpoint: string;
  baseRevision: number;
  iv: string;
  ciphertext: ArrayBuffer;
  apiFetch: typeof fetch;
  storageFetch: typeof fetch;
  signal?: AbortSignal;
}) {
  const headers = { "Content-Type": "application/json", "x-xenode-base-revision": String(input.baseRevision) };
  const control = async (body: object) => {
    const response = await input.apiFetch(input.endpoint, {
      method: "POST", headers, body: JSON.stringify(body), signal: input.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new RevisionUploadError(data.code ?? "revision_upload_failed", response.status, data.revision);
    return data;
  };
  const reservation = await control({ operation: "presign", size: input.ciphertext.byteLength, iv: input.iv });
  const url = new URL(reservation.uploadUrl);
  if (url.protocol !== "https:" || url.username || url.password || !/^[0-9a-f]{24}$/iu.test(reservation.sessionId)) {
    throw new RevisionUploadError("invalid_revision_reservation", 502);
  }
  const uploaded = await input.storageFetch(url.toString(), {
    method: "PUT", headers: { "Content-Type": "application/octet-stream" },
    credentials: "omit", body: input.ciphertext, signal: input.signal,
  });
  if (!uploaded.ok) throw new RevisionUploadError("revision_storage_upload_failed", uploaded.status);
  // An uncertain completion is retried with the same manifest, never a new save.
  let result;
  try {
    result = await control({ operation: "complete", sessionId: reservation.sessionId });
  } catch (error) {
    if (input.signal?.aborted || (error instanceof RevisionUploadError && error.status < 500)) throw error;
    result = await control({ operation: "complete", sessionId: reservation.sessionId });
  }
  if (!Number.isSafeInteger(result.revision) || result.revision < 1) throw new RevisionUploadError("invalid_revision_response", 502);
  return { revision: result.revision as number };
}

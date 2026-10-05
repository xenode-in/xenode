import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/objects/upload-status/route";
import { requireAccessContext } from "@/lib/authz";
import { getObjectMetadata } from "@/lib/b2/objects";
import Bucket from "@/models/Bucket";
import UploadSession from "@/models/UploadSession";
import StorageObject from "@/models/StorageObject";
import { personalSpaceId } from "@xenode/spaces/ids";

vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireAccessContext: vi.fn() };
});
vi.mock("@/lib/b2/objects", () => ({ getObjectMetadata: vi.fn() }));
const accountId = "account_one";
const spaceId = personalSpaceId(accountId);
const fileId = `users/${accountId}/${"a".repeat(32)}`;
const metadata = vi.mocked(getObjectMetadata);
beforeEach(() => {
  vi.mocked(requireAccessContext).mockResolvedValue({
    accountId, userId: accountId, spaceId, spaceType: "personal", region: "asia", scope: { type: "personal" },
  } as never);
  metadata.mockReset();
  metadata.mockResolvedValue({ size: 20, contentType: "application/octet-stream" });
});
afterEach(() => vi.restoreAllMocks());
async function reservation(extra: Record<string, unknown> = {}) {
  const bucket = await Bucket.create({ systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage",
    b2BucketId: "xenode-drive-storage", region: "auto" });
  const session = await UploadSession.create({ userId: accountId, spaceId, bucketId: bucket._id, fileId,
    keys: [fileId, `${fileId}-thumb`], expiresAt: new Date(Date.now() + 60_000), ...extra });
  return { bucket, session };
}
function request(bucketId: unknown, sessionId: unknown, offset = 0) {
  return new NextRequest(`http://localhost/api/objects/upload-status?bucketId=${bucketId}&sessionId=${sessionId}&offset=${offset}`);
}

describe("reservation-bound resume status", () => {
  it("requires reservation identity and write authorization before storage access", async () => {
    const response = await GET(new NextRequest("http://localhost/api/objects/upload-status?fileId=users/account_one/anything"));
    expect(response.status).toBe(400);
    expect(metadata).not.toHaveBeenCalled();
    expect(vi.mocked(requireAccessContext).mock.calls[0][1]).toBe("write");
  });
  it.each([{ userId: "another_account" }, { spaceId: "another_space" }, { purpose: "revision" }])(
    "rejects an unowned or wrong-purpose reservation: %j", async (extra) => {
      const { bucket, session } = await reservation(extra);
      expect((await GET(request(bucket._id, session._id))).status).toBe(404);
      expect(metadata).not.toHaveBeenCalled();
    });
  it("HEADs only exact claimed keys, with a bounded page", async () => {
    const keys = Array.from({ length: 200 }, (_, i) => `${fileId}-chunk-${i}`);
    const { bucket, session } = await reservation({ keys });
    const response = await GET(request(bucket._id, session._id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ spaceId, bucketId: String(bucket._id), sessionId: String(session._id), fileId, nextOffset: 128 });
    expect(metadata).toHaveBeenCalledTimes(128);
    expect(metadata.mock.calls.map((call) => call[1])).toEqual(keys.slice(0, 128));
    expect((await GET(request(bucket._id, session._id, 128))).status).toBe(200);
    expect(metadata).toHaveBeenCalledTimes(200);
  });
  it("treats only a genuine missing-object response as absent", async () => {
    const { bucket, session } = await reservation();
    metadata.mockRejectedValue({ name: "NotFound", $metadata: { httpStatusCode: 404 } });
    const response = await GET(request(bucket._id, session._id));
    expect(response.status).toBe(200);
    expect((await response.json()).objects).toEqual([]);
  });
  it("provider failures fail closed instead of declaring keys absent", async () => {
    const { bucket, session } = await reservation();
    metadata.mockRejectedValue(new Error("provider unavailable"));
    expect((await GET(request(bucket._id, session._id))).status).toBe(502);
  });
  it.each([{ expiresAt: new Date(0) }, { status: "cleaning" }, { cleanupState: "blocked" }])(
    "expired or cleaning reservations cannot resume: %j", async (extra) => {
      const { bucket, session } = await reservation(extra);
      expect((await GET(request(bucket._id, session._id))).status).toBe(409);
      expect(metadata).not.toHaveBeenCalled();
    });
  it("a completed active object returns completion without HEAD or new signing", async () => {
    const { bucket, session } = await reservation({ status: "completed" });
    await StorageObject.collection.insertOne({ _id: session._id, bucketId: bucket._id, key: fileId,
      spaceId, productId: "drive", createdByAccountId: accountId, deletedAt: null });
    const response = await GET(request(bucket._id, session._id));
    expect(response.status).toBe(200);
    expect((await response.json()).completed).toBe(true);
    expect(metadata).not.toHaveBeenCalled();
  });
});

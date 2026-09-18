import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Space, getDatabase } from "@xenode/database";
import type { SpaceRole } from "@xenode/contracts";

const { send, sign, publish } = vi.hoisted(() => ({ send: vi.fn(), sign: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/b2/client", () => ({ getS3Client: () => ({ send }) }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: sign }));
vi.mock("@/lib/subscriptions/service", () => ({ enforceStorageAccess: vi.fn() }));
vi.mock("@/lib/logRequest", () => ({ logRequest: vi.fn() }));
vi.mock("@/lib/realtime/publish", () => ({ publishSyncEvent: publish, parentPrefixForKey: vi.fn(), toSyncObjectSnapshot: vi.fn() }));
vi.mock("@/lib/albums/cleanup", () => ({ removeObjectsFromAlbums: vi.fn() }));

import { getServerSession } from "@/lib/auth/session";
import { requireAccessContext } from "@/lib/authz";
import { POST as presign } from "@/app/api/objects/presign-upload/route";
import { POST as multipart } from "@/app/api/objects/presign-upload-multipart/route";
import { POST as complete } from "@/app/api/objects/complete-upload/route";
import { POST as upload } from "@/app/api/objects/upload/route";
import { PATCH as reorder } from "@/app/api/objects/reorder/route";
import { POST as metadata } from "@/app/api/objects/update-metadata/route";
import { POST as restore } from "@/app/api/objects/restore/route";
import { POST as purge } from "@/app/api/objects/purge/route";
import { POST as completeUpdate } from "@/app/api/objects/[id]/complete-update/route";
import { PATCH as patchObject } from "@/app/api/objects/[id]/route";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";

const accountId = "permission-account";
const organizationId = "permission-org";
const spaceId = `space_org_${organizationId}`;
const mockedSession = vi.mocked(getServerSession);
const params = { params: Promise.resolve({ id: "000000000000000000000001" }) };

function request(method = "POST", body: object = {}) {
  return new NextRequest(`http://localhost/api/objects?spaceId=${spaceId}`, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

async function setRole(role: SpaceRole) {
  await getDatabase().collection("member").updateOne(
    { userId: accountId, organizationId }, { $set: { role } }, { upsert: true },
  );
}

describe("generic storage mutation permissions", () => {
  beforeEach(async () => {
    send.mockReset(); sign.mockReset(); publish.mockReset();
    mockedSession.mockResolvedValue({
      user: { id: accountId }, session: { id: "permission-session" },
    } as unknown as NonNullable<Awaited<ReturnType<typeof getServerSession>>>);
    await Space.create({ _id: spaceId, type: "organization", organizationId, createdByAccountId: accountId });
    await setRole("guest");
  });

  const routes: Array<[string, string, (req: NextRequest) => Promise<Response>]> = [
    ["presign", "POST", presign], ["multipart presign", "POST", multipart],
    ["complete upload", "POST", complete], ["legacy upload", "POST", upload],
    ["reorder", "PATCH", reorder], ["metadata", "POST", metadata],
    ["restore", "POST", restore], ["purge", "POST", purge],
    ["complete update", "POST", (req) => completeUpdate(req, params)],
    ["patch object", "PATCH", (req) => patchObject(req, params)],
  ];

  it.each(routes)("rejects a guest calling %s before storage work", async (_name, method, handler) => {
    const response = await handler(request(method));
    expect(response.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(await StorageObject.countDocuments({})).toBe(0);
  });

  it("continues to authorize guest reads and member writes, but not member deletion", async () => {
    await expect(requireAccessContext(request(), "read")).resolves.toMatchObject({ role: "guest" });
    await setRole("member");
    await expect(requireAccessContext(request(), "write")).resolves.toMatchObject({ role: "member" });
    await expect(requireAccessContext(request(), "delete")).rejects.toMatchObject({ status: 403 });
    expect((await purge(request())).status).toBe(403);
    await setRole("admin");
    await expect(requireAccessContext(request(), "delete")).resolves.toMatchObject({ role: "admin" });
  });

  it("preserves an existing object for guests and allows a member to reorder it", async () => {
    const bucket = await Bucket.create({ systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" });
    const object = await StorageObject.create({ bucketId: bucket._id, spaceId, createdByAccountId: accountId, key: "workspaces/permission-org/file", size: 10, b2FileId: "test", position: 1 });
    const body = { bucketId: String(bucket._id), items: [{ id: String(object._id), position: 9 }] };
    expect((await reorder(request("PATCH", body))).status).toBe(403);
    expect((await StorageObject.findById(object._id))?.position).toBe(1);
    await setRole("member");
    expect((await reorder(request("PATCH", body))).status).toBe(200);
    expect((await StorageObject.findById(object._id))?.position).toBe(9);
  });
});

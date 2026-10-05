import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensurePersonalSpace } from "@xenode/spaces/repository";
import { POST as createLink } from "@/app/api/share/route";
import { GET as readLink, PATCH as patchLink } from "@/app/api/share/[token]/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import ShareLink from "@/models/ShareLink";
import StorageObject from "@/models/StorageObject";

// A bundle's name is user text: the server only ever stores and serves it
// sealed under the share key (bound to the link token).
const mockedSession = vi.mocked(getServerSession);
const ACCOUNT = "bundle_owner";
const TOKEN = "t".repeat(43);
const params = { params: Promise.resolve({ token: TOKEN }) };

function call(method: string, body?: object) {
  return new NextRequest(`http://localhost/api/share/${TOKEN}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("bundle share names", () => {
  afterEach(() => mockedSession.mockReset());

  it("stores, serves and renames only the sealed name", async () => {
    mockedSession.mockResolvedValue({
      user: { id: ACCOUNT, email: `${ACCOUNT}@example.com` },
      session: { id: `session-${ACCOUNT}` },
    } as unknown as NonNullable<Awaited<ReturnType<typeof getServerSession>>>);
    const space = await ensurePersonalSpace(ACCOUNT);
    const bucket = await Bucket.findOneAndUpdate(
      { systemKey: "drive" },
      { $setOnInsert: { systemKey: "drive", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" } },
      { upsert: true, new: true },
    );
    const objects = await Promise.all([1, 2].map((n) => StorageObject.create({
      bucketId: bucket!._id, spaceId: space._id, createdByAccountId: ACCOUNT,
      key: `${n}-ciphertext`, size: 10, b2FileId: "f", isEncrypted: true, encryptedDEK: "wrapped",
    })));

    const created = await createLink(call("POST", {
      token: TOKEN,
      items: objects.map((object) => ({ objectId: String(object._id), shareEncryptedDEK: "dek", shareKeyIv: "iv" })),
      bundleName: "Tax returns 2025",
      shareEncryptedBundleName: "sealed-name",
      ownerEncryptedShareKey: "owner-copy",
    }));
    expect(created.status).toBeLessThan(300);
    const stored = await ShareLink.findOne({ token: TOKEN }).lean();
    expect(stored?.shareEncryptedBundleName).toBe("sealed-name");
    expect(JSON.stringify(stored)).not.toContain("Tax returns");

    const served = await (await readLink(call("GET"), params)).json();
    expect(served.shareEncryptedBundleName).toBe("sealed-name");
    expect(JSON.stringify(served)).not.toContain("Tax returns");

    expect((await patchLink(call("PATCH", { shareEncryptedBundleName: 42 }), params)).status).toBe(400);
    await patchLink(call("PATCH", { bundleName: "Plain rename" }), params);
    expect(JSON.stringify(await ShareLink.findOne({ token: TOKEN }).lean())).not.toContain("Plain rename");
    expect((await patchLink(call("PATCH", { shareEncryptedBundleName: "sealed-2" }), params)).status).toBe(200);
    expect((await ShareLink.findOne({ token: TOKEN }).lean())?.shareEncryptedBundleName).toBe("sealed-2");
  });
});

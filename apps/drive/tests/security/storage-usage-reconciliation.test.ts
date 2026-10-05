import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase, getStorageUsageReconciliation, Space, USAGE_RECONCILIATION_OBJECT_LIMIT, withTransaction } from "@xenode/database";
import { getAdminSession } from "@/lib/admin/session";
import { GET } from "@/app/api/admin/storage-reconciliation/route";
import { computePersonalUsageTotals } from "@/lib/metering/usage";

vi.mock("@/lib/admin/session", () => ({ getAdminSession: vi.fn() }));
const admin = vi.mocked(getAdminSession);
const owner = { type: "organization", id: "org_one" } as const;
const request = (query = "orgId=org_one") => new Request(`http://admin.localhost/api/admin/storage-reconciliation?${query}`);

async function fixture() {
  await Space.create([
    { _id: "org_space", type: "organization", organizationId: "org_one", createdByAccountId: "account" },
    { _id: "team_space", type: "team", organizationId: "org_one", teamId: "team", status: "deleted", createdByAccountId: "account" },
    { _id: "other_space", type: "organization", organizationId: "org_two", createdByAccountId: "account" },
    { _id: "personal_space", type: "personal", ownerAccountId: "account", createdByAccountId: "account" },
  ]);
  const db = getDatabase();
  await db.collection("orgusages").insertOne({
    orgId: owner.id, totalStorageBytes: 293, totalObjects: 4, plan: "org-paid", storageLimitBytes: 9999,
  });
  await db.collection("storageobjects").insertMany([
    { productId: "drive", spaceId: "org_space", size: 100, thumbnailSize: 10, optimizedSize: 20,
      encryptedName: "private-name", encryptedDEK: "private-envelope", key: "private-key", versions: [
        { size: 100, sharesCurrentContent: true },
        { size: 999, chunks: [{ size: 7 }, { size: 9 }], pendingDeletion: true },
        { size: 25, deletionState: "blocked" },
      ] },
    { productId: "photos", spaceId: "team_space", size: 80, thumbnailSize: 5, optimizedSize: 30,
      deletedAt: new Date(), purgeState: "pending" },
    { productId: "drive", spaceId: "team_space", size: 7, isSidecar: true },
    { productId: "drive", spaceId: "org_space", size: 0, contentType: "application/x-directory" },
    { productId: "drive", spaceId: "other_space", size: 500 },
    { productId: "photos", spaceId: "personal_space", size: 1000 },
  ]);
  await db.collection("uploadsessions").insertOne({ spaceId: "org_space", status: "pending", revisionSize: 3000 });
  await db.collection("photoUploads").insertOne({ spaceId: "team_space", status: "reserved", original: { size: 4000 } });
}

beforeEach(() => admin.mockResolvedValue({ id: "operator", username: "operator", role: "admin", sessionVersion: 1 }));
afterEach(async () => {
  // The global fixture clears Mongoose model collections. These deliberately
  // raw byte-summary documents also need their unregistered collections reset.
  for (const name of ["storageobjects", "orgusages", "uploadsessions", "photoUploads"]) {
    await getDatabase().collection(name).deleteMany({});
  }
  vi.restoreAllMocks();
});

describe("read-only storage reconciliation", () => {
  it("counts only the owner's Spaces, all charged products/states, and unique retained content", async () => {
    await fixture();
    const db = getDatabase();
    const before = await db.collection("orgusages").findOne({ orgId: owner.id });
    const report = await getStorageUsageReconciliation(owner);
    expect(report).toMatchObject({
      owner, status: "matched", spaceCount: 2,
      recorded: { totalStorageBytes: 293, totalObjects: 4 },
      computed: { totalStorageBytes: 293, totalObjects: 4 },
      difference: { totalStorageBytes: 0, totalObjects: 0 }, invalidObjects: 0, invalidUsage: false,
    });
    expect(await db.collection("orgusages").findOne({ orgId: owner.id })).toEqual(before);
    expect(JSON.stringify(report)).not.toMatch(/private-name|private-envelope|private-key|org-paid|9999/u);
  });

  it("reports drift through the authenticated route without repairing counters or plans", async () => {
    await fixture();
    const db = getDatabase();
    await db.collection("orgusages").updateOne({ orgId: owner.id }, { $set: { totalStorageBytes: 100, totalObjects: 8 } });
    const before = await db.collection("orgusages").findOne({ orgId: owner.id });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ status: "drift", difference: { totalStorageBytes: 193, totalObjects: -4 } });
    expect(await db.collection("orgusages").findOne({ orgId: owner.id })).toEqual(before);
  });

  it("accepts absent optional fields serialized to BSON null by current upload builders", async () => {
    await fixture();
    const db = getDatabase();
    const inserted = await db.collection("storageobjects").insertOne({
      productId: "photos", spaceId: "team_space", size: 16,
      thumbnailSize: undefined, optimizedSize: undefined, versions: undefined,
    });
    expect(await db.collection("storageobjects").findOne({ _id: inserted.insertedId }))
      .toMatchObject({ thumbnailSize: null, optimizedSize: null, versions: null });
    await db.collection("storageobjects").insertOne({
      productId: "drive", spaceId: "org_space", size: 20,
      versions: [{ size: 7, chunks: undefined, sharesCurrentContent: undefined }],
    });
    await db.collection("orgusages").updateOne({ orgId: owner.id }, { $inc: { totalStorageBytes: 43, totalObjects: 2 } });
    expect(await getStorageUsageReconciliation(owner)).toMatchObject({
      status: "matched", computed: { totalStorageBytes: 336, totalObjects: 6 }, invalidObjects: 0,
    });
  });

  it("reports a missing usage record without creating one", async () => {
    await fixture();
    await getDatabase().collection("orgusages").deleteMany({});
    expect(await getStorageUsageReconciliation(owner)).toMatchObject({
      status: "missing_usage", recorded: null, computed: { totalStorageBytes: 293, totalObjects: 4 }, difference: null,
    });
    expect(await getDatabase().collection("orgusages").countDocuments()).toBe(0);
    expect(await computePersonalUsageTotals("account")).toEqual({ totalStorageBytes: 1000, totalObjects: 1 });
  });

  it.each([
    { size: -1 }, { size: Number.MAX_SAFE_INTEGER + 1 }, { size: 1, optimizedSize: "secret" },
    { size: 1, versions: [{ chunks: [{ size: -1 }] }] }, { size: 1, versions: "secret" },
    { size: 1, versions: ["secret"] }, { size: 1, versions: [{ size: 5, chunks: "secret" }] },
    { size: 1, versions: [{ size: 5, chunks: ["secret"] }] },
    { size: 1, productId: "unknown" },
  ])("refuses to claim valid totals for malformed byte metadata: %j", async (fields) => {
    await fixture();
    await getDatabase().collection("storageobjects").insertOne({ productId: "drive", spaceId: "org_space", ...fields });
    expect(await getStorageUsageReconciliation(owner)).toMatchObject({
      status: "invalid_data", invalidObjects: 1, computed: null, difference: null,
    });
  });

  it("reports invalid counters and sum overflow without returning a repair delta", async () => {
    await fixture();
    await getDatabase().collection("orgusages").updateOne({ orgId: owner.id }, { $set: { totalStorageBytes: "secret" } });
    expect(await getStorageUsageReconciliation(owner)).toMatchObject({ status: "invalid_data", invalidUsage: true, recorded: null, difference: null });
    await getDatabase().collection("storageobjects").insertOne({ productId: "drive", spaceId: "org_space", size: Number.MAX_SAFE_INTEGER });
    expect(await getStorageUsageReconciliation(owner)).toMatchObject({ status: "invalid_data", computed: null, difference: null });
  });

  it("keeps a concurrent transactional storage write and its counter in one snapshot", async () => {
    await fixture();
    const reports = Array.from({ length: 8 }, () => getStorageUsageReconciliation(owner));
    await withTransaction(async (session) => {
      await getDatabase().collection("storageobjects").insertOne({ productId: "drive", spaceId: "org_space", size: 16 }, { session });
      await getDatabase().collection("orgusages").updateOne({ orgId: owner.id }, { $inc: { totalStorageBytes: 16, totalObjects: 1 } }, { session });
    });
    for (const report of await Promise.all(reports)) {
      expect(report.status).toBe("matched");
      expect([293, 309]).toContain(report.computed?.totalStorageBytes);
    }
  });

  it("bounds a large scan and never reports truncated totals as matched", async () => {
    await fixture();
    await getDatabase().collection("storageobjects").insertMany(
      Array.from({ length: USAGE_RECONCILIATION_OBJECT_LIMIT }, () => ({ productId: "drive", spaceId: "org_space", size: 16 })),
    );
    expect(await getStorageUsageReconciliation(owner)).toMatchObject({ status: "scan_limit", computed: null, difference: null });
  });

  it("rejects unauthenticated or malformed requests before querying Spaces", async () => {
    const find = vi.spyOn(Space, "find");
    admin.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("orgId=%24ne"))).status).toBe(400);
    expect(find).not.toHaveBeenCalled();
  });
});

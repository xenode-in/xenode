import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Types } from "mongoose";
import { AccountProfile, AuditEvent, connectDatabase, disconnectDatabaseForTests, getDatabase } from "@xenode/database";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/api-session", () => ({ authorizeAccountsApiRequest: mocks.authorize }));
vi.mock("@/lib/session", () => ({ getAccountsSession: mocks.session }));
import { POST } from "../app/api/onboarding/complete/route";

let server: MongoMemoryReplSet;
let accountId: string;
const originalUri = process.env.MONGODB_URI;

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = server.getUri();
  await connectDatabase();
  await AccountProfile.init();
}, 30_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.stubEnv("STORAGE_ENABLED_REGIONS", "asia,us");
  for (const collection of await getDatabase().collections()) await collection.deleteMany({});
  const ref = new Types.ObjectId();
  accountId = ref.toHexString();
  await getDatabase().collection("user").insertOne({ _id: ref, username: "storage_user", name: "Storage User" });
  mocks.authorize.mockResolvedValue(null);
  mocks.session.mockResolvedValue({ user: { id: accountId } });
});

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await disconnectDatabaseForTests();
  await server.stop();
  if (originalUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = originalUri;
});

const request = (region?: string, extra: object = {}) => new Request("http://localhost:3001/api/onboarding/complete", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ region, ...extra }),
});

describe("onboarding storage pool contract", () => {
  it.each([undefined, "moon", "eu"])("rejects missing, unknown or disabled selection: %s", async (region) => {
    expect((await POST(request(region))).status).toBe(400);
    expect(await AccountProfile.countDocuments()).toBe(0);
    expect(await AuditEvent.countDocuments()).toBe(0);
  });

  it("records an enabled selection and refuses a later reassignment", async () => {
    expect((await POST(request("us"))).status).toBe(200);
    expect((await AccountProfile.findOne({ accountId }))?.storageRegion).toBe("us");
    expect((await POST(request("asia", { theme: "dark" }))).status).toBe(409);
    const profile = await AccountProfile.findOne({ accountId }).lean();
    expect(profile?.storageRegion).toBe("us");
    expect(profile?.theme).not.toBe("dark");
  });

  it("keeps one immutable choice when concurrent tabs choose different pools", async () => {
    const responses = await Promise.all([POST(request("asia")), POST(request("us"))]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await AccountProfile.countDocuments({ accountId })).toBe(1);
    const winner = await responses.find((response) => response.status === 200)!.json();
    expect((await AccountProfile.findOne({ accountId }))?.storageRegion).toBe(winner.storageRegion);
    expect(await AuditEvent.countDocuments()).toBe(1);
  });

  it("rolls back preferences and identity edits if the transactional audit write fails", async () => {
    vi.spyOn(AuditEvent, "create").mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(POST(request("asia", { username: "new_storage_user" }))).rejects.toThrow("audit unavailable");
    expect(await AccountProfile.countDocuments()).toBe(0);
    expect((await getDatabase().collection("user").findOne({ _id: new Types.ObjectId(accountId) }))?.username).toBe("storage_user");
  });
});

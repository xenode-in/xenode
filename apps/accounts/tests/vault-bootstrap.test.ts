import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { AuditEvent, Space, SpaceProductKey, UserVault, connectDatabase, disconnectDatabaseForTests, getDatabase } from "@xenode/database";
import { encodeBase64Url, generateAccountRootKey, openEnvelope, sealEnvelope } from "@xenode/crypto-core";
import { personalSpaceId } from "@xenode/spaces/ids";
import type { VaultBootstrapPayload } from "../lib/vault-bootstrap-payload";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAccountsAuth: async () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/lib/api-session", () => ({ authorizeAccountsApiRequest: mocks.guard }));
import { POST } from "../app/api/vault/bootstrap/route";
import * as vaultRoute from "../app/api/vault/route";
import * as keyRoute from "../app/api/space-product-keys/route";

const accountId = "bootstrap-account";
const spaceId = personalSpaceId(accountId);
const origin = "https://accounts.example.test";
const previousUri = process.env.MONGODB_URI;
let server: MongoMemoryReplSet;
let material: Awaited<ReturnType<typeof fixture>>;

async function fixture(account = accountId) {
  const ark = generateAccountRootKey();
  const wrappingKey = generateAccountRootKey();
  const context = { accountId: account, keyId: "ark", keyVersion: 1 };
  const productEnvelopes = {} as VaultBootstrapPayload["productEnvelopes"];
  for (const productId of ["drive", "photos"] as const) {
    productEnvelopes[productId] = await sealEnvelope(generateAccountRootKey(), ark, {
      ...context, spaceId: personalSpaceId(account), productId,
      keyId: `${personalSpaceId(account)}:${productId}`, type: "product-space-key",
    });
  }
  const payload: VaultBootstrapPayload = {
    passwordMode: "separate",
    passwordEnvelope: {
      ...(await sealEnvelope(ark, wrappingKey, { ...context, type: "password" })),
      kdfParams: { algorithm: "argon2id", memoryKiB: 65536, iterations: 3, parallelism: 1, outputLength: 32, salt: encodeBase64Url(new Uint8Array(16)) },
    },
    recoveryEnvelope: await sealEnvelope(ark, wrappingKey, { ...context, type: "recovery" }),
    deviceEnvelopes: [],
    sharingPublicKey: encodeBase64Url(new Uint8Array(550)),
    wrappedSharingPrivateKey: await sealEnvelope(new Uint8Array(2300), ark, { ...context, keyId: "sharing-private-key", type: "sharing-private-key" }),
    productEnvelopes,
  };
  wrappingKey.fill(0);
  return { payload, ark };
}

function request(payload: unknown = material.payload, operation = "bootstrap-operation-0001") {
  return new Request(`${origin}/api/vault/bootstrap`, {
    method: "POST", headers: { origin, "content-type": "application/json", "idempotency-key": operation },
    body: JSON.stringify(payload),
  });
}

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = server.getUri();
  await connectDatabase();
  await Promise.all([UserVault.init(), Space.init(), SpaceProductKey.init(), AuditEvent.init()]);
}, 30_000);
beforeEach(async () => {
  mocks.guard.mockResolvedValue(null);
  mocks.getSession.mockResolvedValue({ user: { id: accountId }, session: { createdAt: new Date() } });
  material = await fixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  material.ark.fill(0);
  for (const collection of await getDatabase().collections()) await collection.deleteMany({});
});
afterAll(async () => {
  await disconnectDatabaseForTests();
  await server.stop();
  if (previousUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = previousUri;
});

describe("atomic Vault bootstrap", () => {
  it("commits the Vault, personal Space, both key envelopes and one sanitized event together", async () => {
    expect((await POST(request())).status).toBe(201);
    expect(await UserVault.countDocuments()).toBe(1);
    expect(await Space.countDocuments({ _id: spaceId, ownerAccountId: accountId, status: "active" })).toBe(1);
    expect(await SpaceProductKey.countDocuments()).toBe(2);
    const event = await AuditEvent.findOne({ accountId }).lean();
    expect(event?.action).toBe("vault.created");
    expect(JSON.stringify(event)).not.toContain(material.payload.passwordEnvelope.ciphertext);
  });

  it("gives concurrent tabs one complete winning hierarchy without replacing any key", async () => {
    const other = await fixture();
    try {
      const results = await Promise.all([POST(request()), POST(request(other.payload, "bootstrap-operation-0002"))]);
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      const winner = results[0].status === 201 ? material : other;
      const vault = await UserVault.findOne({ accountId }).lean();
      expect(vault?.sharingPublicKey).toBe(winner.payload.sharingPublicKey);
      expect((vault?.recoveryEnvelope as { ciphertext: string }).ciphertext).toBe(winner.payload.recoveryEnvelope.ciphertext);
      for (const productId of ["drive", "photos"] as const) {
        const stored = await SpaceProductKey.findOne({ spaceId, productId }).lean();
        const envelope = winner.payload.productEnvelopes[productId];
        expect(stored?.ciphertext).toBe(envelope.ciphertext);
        expect((await openEnvelope({ ...envelope, ciphertext: stored!.ciphertext }, winner.ark, envelope)).length).toBe(32);
      }
      expect(await AuditEvent.countDocuments({ accountId, action: "vault.created" })).toBe(1);
    } finally { other.ark.fill(0); }
  });

  it("returns the original receipt for concurrent retries and after later envelope mutations", async () => {
    const responses = await Promise.all([POST(request()), POST(request())]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const keys = await SpaceProductKey.find().lean();
    await UserVault.updateOne({ accountId }, { $set: { lastMutationId: "later-device-change" }, $inc: { vaultRevision: 1 } });
    const reordered = Object.fromEntries(Object.entries(material.payload).reverse());
    const retried = await POST(request(reordered));
    expect(await retried.json()).toEqual({ vault: { vaultRevision: 1 }, idempotent: true });
    expect(await SpaceProductKey.find().lean()).toEqual(keys);
    expect(await AuditEvent.countDocuments({ action: "vault.created" })).toBe(1);
  });

  it("rejects a reused operation identity with changed ciphertext", async () => {
    expect((await POST(request())).status).toBe(201);
    const changed = structuredClone(material.payload);
    changed.productEnvelopes.photos.ciphertext = encodeBase64Url(new Uint8Array(48));
    expect((await POST(request(changed))).status).toBe(409);
    expect((await SpaceProductKey.findOne({ productId: "photos" }).lean())?.ciphertext).toBe(material.payload.productEnvelopes.photos.ciphertext);
  });

  it.each(["second-key", "audit-event"])("rolls every record back if %s insertion fails, then accepts the same retry", async (failure) => {
    if (failure === "second-key") {
      const create = SpaceProductKey.create.bind(SpaceProductKey);
      vi.spyOn(SpaceProductKey, "create").mockImplementationOnce(create).mockImplementationOnce(() => { throw new Error("injected key failure"); });
    } else {
      vi.spyOn(AuditEvent, "create").mockImplementationOnce(() => { throw new Error("injected audit failure"); });
    }
    expect((await POST(request())).status).toBe(503);
    expect(await UserVault.countDocuments()).toBe(0);
    expect(await SpaceProductKey.countDocuments()).toBe(0);
    expect(await Space.countDocuments()).toBe(0);
    expect((await POST(request())).status).toBe(201);
  });

  it("refuses existing orphan envelopes without overwriting them or leaving a Vault", async () => {
    await SpaceProductKey.create({ _id: "existing-orphan", spaceId, productId: "drive", memberAccountId: accountId,
      keyVersion: 1, formatVersion: 2, algorithm: "AES-256-GCM", ciphertext: "original", aadVersion: 1, status: "active", createdByAccountId: accountId });
    expect((await POST(request())).status).toBe(409);
    expect(await UserVault.countDocuments()).toBe(0);
    expect((await SpaceProductKey.findById("existing-orphan").lean())?.ciphertext).toBe("original");
  });

  it("preserves a suspended personal Space rather than reactivating it", async () => {
    await Space.create({ _id: spaceId, type: "personal", ownerAccountId: accountId, status: "suspended", createdByAccountId: accountId });
    expect((await POST(request())).status).toBe(409);
    expect(await UserVault.countDocuments()).toBe(0);
    expect((await Space.findById(spaceId).lean())?.status).toBe("suspended");
  });

  it("accepts only an explicitly supplied browser-device envelope bound to this account", async () => {
    const deviceId = "12345678-1234-1234-1234-123456789abc";
    const wrappingKey = generateAccountRootKey();
    try {
      material.payload.deviceEnvelopes = [{
        ...(await sealEnvelope(material.ark, wrappingKey, { accountId, keyId: `ark:device:${deviceId}`, keyVersion: 1, type: "device" })),
        kdfParams: { algorithm: "browser-device-aes-gcm", deviceId, deviceName: "Test browser", createdAt: new Date().toISOString() },
      }];
      expect((await POST(request())).status).toBe(201);
      expect((await UserVault.findOne({ accountId }).lean())?.deviceEnvelopes).toHaveLength(1);
    } finally { wrappingKey.fill(0); }
  });

  it.each(["cross-account", "cross-space", "swapped-products", "missing-product", "plaintext", "bad-iv", "bad-kdf"])("rejects %s before creating any records", async (invalid) => {
    const payload = structuredClone(material.payload);
    if (invalid === "cross-account") payload.passwordEnvelope.accountId = "other-account";
    if (invalid === "cross-space") payload.productEnvelopes.drive.spaceId = "other-space";
    if (invalid === "swapped-products") payload.productEnvelopes.drive = payload.productEnvelopes.photos;
    if (invalid === "missing-product") delete (payload.productEnvelopes as Partial<typeof payload.productEnvelopes>).photos;
    if (invalid === "plaintext") Object.assign(payload.passwordEnvelope.kdfParams, { password: "must-never-be-stored" });
    if (invalid === "bad-iv") payload.recoveryEnvelope.iv = "AAAAAAAAAAAAAAAAAA";
    if (invalid === "bad-kdf") payload.passwordEnvelope.kdfParams.memoryKiB = 1;
    expect((await POST(request(payload))).status).toBe(400);
    expect(await UserVault.countDocuments()).toBe(0);
    expect(await SpaceProductKey.countDocuments()).toBe(0);
  });

  it("requires recent authentication and a valid operation identity", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { id: accountId }, session: { createdAt: new Date(Date.now() - 11 * 60 * 1000) } });
    expect((await POST(request())).status).toBe(403);
    expect((await POST(request(material.payload, "short"))).status).toBe(400);
    expect(await UserVault.countDocuments()).toBe(0);
  });

  it("has no standalone Vault or product-key replacement handler", () => {
    expect(vaultRoute).not.toHaveProperty("PUT");
    expect(keyRoute).not.toHaveProperty("PUT");
  });
});

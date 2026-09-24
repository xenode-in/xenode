import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  AccountProfile,
  UserVault,
  connectDatabase,
  disconnectDatabaseForTests,
  getDatabase,
  getAccountOnboardingReadiness,
} from "@xenode/database";
import { generateAccountRootKey, sealEnvelope } from "@xenode/crypto-core";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  changePassword: vi.fn(),
  verifyPassword: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  getAccountsAuth: async () => ({
    api: {
      getSession: mocks.getSession,
      changePassword: mocks.changePassword,
      verifyPassword: mocks.verifyPassword,
    },
  }),
}));
vi.mock("@/lib/logout-coordinator", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logout-coordinator")>()),
  revokeProductSessions: mocks.revoke,
}));

import { PUT } from "../app/api/vault/separate-password/route";
import { GET as readVault } from "../app/api/vault/route";
import { VAULT_CLIENT_HEADERS } from "../lib/vault-protocol";
import { POST as unlock } from "../app/api/vault/unlock/route";
import {
  POST as changePassword,
  PUT as retiredCommit,
} from "../app/api/account/password/change/route";

const accountId = "password-route-account";
const origin = "https://accounts.example.test";
const prior = {
  uri: process.env.MONGODB_URI,
  origin: process.env.ACCOUNTS_ORIGIN,
  secret: process.env.BETTER_AUTH_SECRET,
};
let server: MongoMemoryReplSet;
let envelope: Awaited<ReturnType<typeof makeEnvelope>>;

async function makeEnvelope() {
  const ark = generateAccountRootKey();
  const key = generateAccountRootKey();
  try {
    return {
      ...(await sealEnvelope(ark, key, {
        accountId,
        keyId: "ark",
        keyVersion: 1,
        type: "password",
      })),
      kdfParams: {
        algorithm: "argon2id",
        memoryKiB: 65536,
        iterations: 3,
        parallelism: 1,
        outputLength: 32,
        salt: "AAAAAAAAAAAAAAAAAAAAAA",
      },
    };
  } finally {
    ark.fill(0);
    key.fill(0);
  }
}

function request(
  body: object,
  id = "idempotent-vault-change-0001",
  suppliedOrigin = origin,
) {
  return new Request(`${origin}/api/vault/separate-password`, {
    method: "PUT",
    headers: {
      origin: suppliedOrigin,
      "content-type": "application/json",
      "idempotency-key": id,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = server.getUri();
  process.env.ACCOUNTS_ORIGIN = origin;
  process.env.BETTER_AUTH_SECRET =
    "synthetic-vault-route-test-secret-only-0001";
  await connectDatabase();
  await UserVault.init();
});
afterEach(async () => {
  for (const collection of await getDatabase().collections())
    await collection.deleteMany({});
});
afterAll(async () => {
  await disconnectDatabaseForTests();
  await server.stop();
  for (const [name, value] of Object.entries({
    MONGODB_URI: prior.uri,
    ACCOUNTS_ORIGIN: prior.origin,
    BETTER_AUTH_SECRET: prior.secret,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
beforeEach(async () => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getSession.mockResolvedValue({
    user: { id: accountId },
    session: { id: "issuer-session", createdAt: new Date() },
  });
  mocks.changePassword.mockResolvedValue({
    headers: new Headers(),
    response: { ok: true },
  });
  envelope = await makeEnvelope();
  await UserVault.create({
    accountId,
    vaultRevision: 1,
    formatVersion: 2,
    passwordEnvelope: envelope,
    recoveryEnvelope: { ...envelope, type: "recovery" },
    deviceEnvelopes: [],
    sharingPublicKey: "synthetic-public-key",
    wrappedSharingPrivateKey: { ...envelope, type: "sharing-private-key" },
  });
});

describe("separate Vault password routes", () => {
  it("requires old browser bundles to reload before exposing Vault envelopes", async () => {
    expect((await readVault(new Request(`${origin}/api/vault`))).status).toBe(
      409,
    );
    const response = await readVault(
      new Request(`${origin}/api/vault`, { headers: VAULT_CLIENT_HEADERS }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).accountId).toBe(accountId);
  });
  it("atomically replaces only the password wrap and handles an identical retry", async () => {
    const before = await UserVault.findOne({ accountId }).lean();
    const next = await makeEnvelope();
    const body = { expectedVaultRevision: 1, passwordEnvelope: next };
    expect((await PUT(request(body))).status).toBe(200);
    const retry = await PUT(request(body));
    expect(retry.status).toBe(200);
    expect((await retry.json()).idempotent).toBe(true);
    const after = await UserVault.findOne({ accountId }).lean();
    expect(after?.vaultRevision).toBe(2);
    expect(after?.passwordMode).toBe("separate");
    expect(after?.recoveryEnvelope).toEqual(before?.recoveryEnvelope);
    expect(after?.wrappedSharingPrivateKey).toEqual(
      before?.wrappedSharingPrivateKey,
    );
    expect(after?.sharingPublicKey).toBe(before?.sharingPublicKey);
    expect(mocks.changePassword).not.toHaveBeenCalled();
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
  });

  it("allows only one competing revision update", async () => {
    const results = await Promise.all([
      PUT(
        request(
          { expectedVaultRevision: 1, passwordEnvelope: await makeEnvelope() },
          "competing-change-0001",
        ),
      ),
      PUT(
        request(
          { expectedVaultRevision: 1, passwordEnvelope: await makeEnvelope() },
          "competing-change-0002",
        ),
      ),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect((await UserVault.findOne({ accountId }).lean())?.vaultRevision).toBe(
      2,
    );
  });

  it.each(["password", "recoveryPhrase", "accountRootKey"])(
    "rejects raw %s payload fields",
    async (field) => {
      const response = await PUT(
        request({
          expectedVaultRevision: 1,
          passwordEnvelope: envelope,
          [field]: "must-not-be-accepted",
        }),
      );
      expect(response.status).toBe(400);
      expect(
        (await UserVault.findOne({ accountId }).lean())?.vaultRevision,
      ).toBe(1);
    },
  );

  it("rejects cross-origin, stale and pending-second-factor mutations", async () => {
    const body = { expectedVaultRevision: 1, passwordEnvelope: envelope };
    expect(
      (await PUT(request(body, undefined, "https://untrusted.example.test")))
        .status,
    ).toBe(403);
    mocks.getSession.mockResolvedValue({
      user: { id: accountId },
      session: { id: "old", createdAt: new Date(0) },
    });
    expect((await PUT(request(body))).status).toBe(403);
    mocks.getSession.mockResolvedValue({
      user: { id: accountId, twoFactorEnabled: true },
      session: { id: "pending", createdAt: new Date(), authMethod: "oauth" },
    });
    expect((await PUT(request(body))).status).toBe(403);
  });

  it("requires migration for product readiness, without requiring an OAuth user to add login credentials", async () => {
    await AccountProfile.create({ accountId, onboarded: true });
    expect((await getAccountOnboardingReadiness(accountId)).complete).toBe(
      false,
    );
    await PUT(
      request({ expectedVaultRevision: 1, passwordEnvelope: envelope }),
    );
    const ready = await getAccountOnboardingReadiness(accountId);
    expect(ready.complete).toBe(true);
    expect(ready.hasPasswordCredential).toBe(false);
  });

  it("rejects password-bearing unlock confirmation and requires a separated Vault", async () => {
    expect(
      (
        await unlock(
          request({
            method: "password",
            password: "never-send-a-vault-password",
          }),
        )
      ).status,
    ).toBe(400);
    expect((await unlock(request({ method: "password" }))).status).toBe(409);
    await PUT(
      request({ expectedVaultRevision: 1, passwordEnvelope: envelope }),
    );
    expect((await unlock(request({ method: "password" }))).status).toBe(200);
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
  });

  it("changes only sign-in credentials after migration, preserving the Vault", async () => {
    const body = {
      currentPassword: "old-login-password-only",
      newPassword: "new-login-password-only",
      revokeOtherSessions: true,
    };
    expect((await changePassword(request(body))).status).toBe(409);
    await PUT(
      request({ expectedVaultRevision: 1, passwordEnvelope: envelope }),
    );
    const before = await UserVault.findOne({ accountId }).lean();
    expect((await changePassword(request(body))).status).toBe(200);
    expect(await UserVault.findOne({ accountId }).lean()).toEqual(before);
    expect(mocks.changePassword).toHaveBeenCalledWith(
      expect.objectContaining({ body }),
    );
    expect(mocks.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ exceptIssuerSessionId: "issuer-session" }),
    );
    expect(retiredCommit().status).toBe(410);
  });
});

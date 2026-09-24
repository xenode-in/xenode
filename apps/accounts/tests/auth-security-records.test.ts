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
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { passkey } from "@better-auth/passkey";
import {
  AccountPasskeyBinding,
  TrustedSecondFactor,
  UserVault,
  connectDatabase,
  createAuthSecurityRepository,
  disconnectDatabaseForTests,
  getDatabase,
} from "@xenode/database";
import {
  generateAccountRootKey,
  sealEnvelope,
  type EnvelopeType,
} from "@xenode/crypto-core";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  verifyTOTP: vi.fn(),
  verifyBackupCode: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  getAccountsAuth: async () => ({ api: mocks }),
}));

import {
  GET as getPasskeys,
  POST as bindPasskey,
} from "../app/api/account/passkeys/route";
import { POST as verifySecondFactor } from "../app/api/account/two-factor/verify/route";
import {
  applyTrustedSecondFactor,
  createTrustedSecondFactor,
  TRUSTED_SECOND_FACTOR_COOKIE,
} from "../lib/trusted-second-factor";
import { ACCOUNT_PASSKEY_PRF_INPUT } from "../lib/passkey-constants";

const origin = "https://accounts.example.test";
const previousEnv = {
  MONGODB_URI: process.env.MONGODB_URI,
  ACCOUNTS_ORIGIN: process.env.ACCOUNTS_ORIGIN,
};
let server: MongoMemoryReplSet;
let auth: ReturnType<typeof makeAuth>;

function makeAuth() {
  return betterAuth({
    baseURL: origin,
    secret: "synthetic-auth-record-integration-secret-00001",
    database: mongodbAdapter(
      getDatabase() as unknown as Parameters<typeof mongodbAdapter>[0],
      { usePlural: false, transaction: false },
    ),
    emailAndPassword: { enabled: true },
    plugins: [passkey({ origin, rpID: "accounts.example.test" })],
  });
}

function request(path: string, body?: object) {
  return new Request(`${origin}${path}`, {
    method: body ? "POST" : "GET",
    headers: { origin, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function seedAdapterRecords() {
  // These records are written by the real installed Better Auth Mongo adapter,
  // including ObjectId conversion. WebAuthn/TOTP ceremonies are not simulated.
  const signup = await auth.api.signUpEmail({
    body: {
      email: `${crypto.randomUUID()}@example.test`,
      name: "Synthetic user",
      password: "synthetic-login-password-123",
    },
    headers: new Headers({ origin }),
  });
  const context = await auth.$context;
  const credentialId = crypto.randomUUID();
  const created = await context.adapter.create<{ id: string }>({
    model: "passkey",
    data: {
      userId: signup.user.id,
      credentialID: credentialId,
      publicKey: "synthetic-public-key-no-authenticator",
      name: "Synthetic passkey",
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      createdAt: new Date(),
    },
  });
  const session = await getDatabase()
    .collection("session")
    .findOne({ token: signup.token });
  if (!session) throw new Error("Adapter did not create a session");
  const accountId = signup.user.id;
  const caller = {
    user: { id: accountId, twoFactorEnabled: true },
    session: {
      id: String(session._id),
      createdAt: new Date(),
      authMethod: "oauth",
      twoFactorVerifiedAt: null as Date | null,
    },
  };
  mocks.getSession.mockResolvedValue(caller);
  return { accountId, passkeyId: created.id, credentialId, session, caller };
}

async function makeEnvelope(
  accountId: string,
  type: EnvelopeType,
  keyId = "ark",
) {
  const key = generateAccountRootKey();
  try {
    return await sealEnvelope(new Uint8Array(32), key, {
      accountId,
      keyId,
      keyVersion: 1,
      type,
    });
  } finally {
    key.fill(0);
  }
}

async function seedVault(accountId: string) {
  await UserVault.create({
    accountId,
    vaultRevision: 1,
    formatVersion: 2,
    passwordMode: "separate",
    passwordEnvelope: await makeEnvelope(accountId, "password"),
    recoveryEnvelope: await makeEnvelope(accountId, "recovery"),
    wrappedSharingPrivateKey: await makeEnvelope(
      accountId,
      "sharing-private-key",
      "sharing-private-key",
    ),
    sharingPublicKey: "synthetic-sharing-public-key",
    deviceEnvelopes: [],
  });
}

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = server.getUri();
  process.env.ACCOUNTS_ORIGIN = origin;
  await connectDatabase();
  await AccountPasskeyBinding.init();
  auth = makeAuth();
});
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.verifyTOTP.mockResolvedValue({ headers: new Headers() });
  mocks.verifyBackupCode.mockResolvedValue({ headers: new Headers() });
});
afterEach(async () => {
  for (const collection of await getDatabase().collections())
    await collection.deleteMany({});
});
afterAll(async () => {
  await disconnectDatabaseForTests();
  await server.stop();
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Better Auth Mongo security records", () => {
  it("normalizes real adapter passkey IDs and enforces owner and credential matching", async () => {
    const seeded = await seedAdapterRecords();
    const repo = createAuthSecurityRepository(getDatabase());
    const raw = await getDatabase()
      .collection("passkey")
      .findOne({ credentialID: seeded.credentialId });
    expect(raw?._id._bsontype).toBe("ObjectId");
    expect(raw?.userId._bsontype).toBe("ObjectId");
    expect(raw).not.toHaveProperty("id");
    expect(await repo.listPasskeysForUser(seeded.accountId)).toEqual([
      expect.objectContaining({
        id: seeded.passkeyId,
        credentialID: seeded.credentialId,
      }),
    ]);
    expect(await repo.findPasskeyForUser(seeded)).toMatchObject({
      id: seeded.passkeyId,
    });
    expect(
      await repo.findPasskeyForUser({
        ...seeded,
        accountId: "another-account",
      }),
    ).toBeNull();
    expect(
      await repo.findPasskeyForUser({
        ...seeded,
        credentialId: "another-credential",
      }),
    ).toBeNull();
  });

  it("supports string IDs without widening account scope", async () => {
    const db = getDatabase();
    await db
      .collection<{
        _id: string;
        userId: string;
        credentialID: string;
      }>("passkey")
      .insertOne({
        _id: "string-passkey",
        userId: "string-user",
        credentialID: "string-credential",
      });
    await db
      .collection<{ _id: string; userId: string; expiresAt: Date }>("session")
      .insertOne({
        _id: "string-session",
        userId: "string-user",
        expiresAt: new Date(Date.now() + 60_000),
      });
    const repo = createAuthSecurityRepository(db);
    expect(
      await repo.findPasskeyForUser({
        accountId: "string-user",
        passkeyId: "string-passkey",
        credentialId: "string-credential",
      }),
    ).toMatchObject({ id: "string-passkey" });
    expect(
      await repo.markSecondFactorVerified({
        accountId: "wrong",
        sessionId: "string-session",
      }),
    ).toBe(false);
    expect(
      await repo.markSecondFactorVerified({
        accountId: "string-user",
        sessionId: "string-session",
      }),
    ).toBe(true);
  });

  it("binds and lists an adapter-created passkey without deleting the winner on a duplicate bind", async () => {
    const seeded = await seedAdapterRecords();
    await seedVault(seeded.accountId);
    const envelope = {
      ...(await makeEnvelope(
        seeded.accountId,
        "device",
        "ark:account-passkey:synthetic",
      )),
      kdfParams: { algorithm: "webauthn-prf-hkdf-sha256" },
    };
    const body = {
      passkeyId: seeded.passkeyId,
      credentialId: seeded.credentialId,
      expectedVaultRevision: 1,
      envelope,
      prfInput: ACCOUNT_PASSKEY_PRF_INPUT,
      hkdfSalt: "synthetic-salt",
    };
    expect(
      (await bindPasskey(request("/api/account/passkeys", body))).status,
    ).toBe(200);
    expect(
      (await bindPasskey(request("/api/account/passkeys", body))).status,
    ).toBe(409);
    expect(
      await AccountPasskeyBinding.countDocuments({
        accountId: seeded.accountId,
      }),
    ).toBe(1);
    const list = await getPasskeys(request("/api/account/passkeys"));
    expect((await list.json()).passkeys).toEqual([
      expect.objectContaining({ id: seeded.passkeyId }),
    ]);
    expect(
      (
        await getPasskeys(
          request(`/api/account/passkeys?credentialId=${seeded.credentialId}`),
        )
      ).status,
    ).toBe(200);
    await getDatabase().collection("passkey").deleteMany({});
    expect(
      (
        await getPasskeys(
          request(`/api/account/passkeys?credentialId=${seeded.credentialId}`),
        )
      ).status,
    ).toBe(404);
  });

  it("does not bind another account's native passkey", async () => {
    const seeded = await seedAdapterRecords();
    mocks.getSession.mockResolvedValue({
      user: { id: "wrong-user" },
      session: { id: "wrong-session" },
    });
    const envelope = {
      ...(await makeEnvelope(
        "wrong-user",
        "device",
        "ark:account-passkey:synthetic",
      )),
      kdfParams: {},
    };
    const response = await bindPasskey(
      request("/api/account/passkeys", {
        passkeyId: seeded.passkeyId,
        credentialId: seeded.credentialId,
        expectedVaultRevision: 1,
        envelope,
        prfInput: ACCOUNT_PASSKEY_PRF_INPUT,
        hkdfSalt: "synthetic-salt",
      }),
    );
    expect(response.status).toBe(404);
    expect(await AccountPasskeyBinding.countDocuments({})).toBe(0);
  });

  it.each(["totp", "backup"])(
    "persists successful %s verification on the real issuer session",
    async (method) => {
      const seeded = await seedAdapterRecords();
      const response = await verifySecondFactor(
        request("/api/account/two-factor/verify", {
          code: "synthetic-code",
          trustDevice: false,
          method,
        }),
      );
      expect(response.status).toBe(200);
      const row = await getDatabase()
        .collection("session")
        .findOne({ _id: seeded.session._id });
      expect(row?.authMethod).toBe("totp");
      expect(row?.twoFactorVerifiedAt).toBeInstanceOf(Date);
    },
  );

  it("fails closed when the session disappears during verification", async () => {
    await seedAdapterRecords();
    await getDatabase().collection("session").deleteMany({});
    const response = await verifySecondFactor(
      request("/api/account/two-factor/verify", {
        code: "synthetic-code",
        trustDevice: true,
        method: "totp",
      }),
    );
    expect(response.status).toBe(401);
    expect(await TrustedSecondFactor.countDocuments({})).toBe(0);
  });

  it("persists trusted second-factor use and rejects expired sessions", async () => {
    const seeded = await seedAdapterRecords();
    const token = await createTrustedSecondFactor(seeded.accountId);
    const headers = new Headers({
      cookie: `${TRUSTED_SECOND_FACTOR_COOKIE}=${token}`,
    });
    expect(await applyTrustedSecondFactor(seeded.caller, headers)).toBe(true);
    expect(
      (
        await getDatabase()
          .collection("session")
          .findOne({ _id: seeded.session._id })
      )?.authMethod,
    ).toBe("totp");
    seeded.caller.session.authMethod = "oauth";
    seeded.caller.session.twoFactorVerifiedAt = null;
    await getDatabase()
      .collection("session")
      .updateOne(
        { _id: seeded.session._id },
        { $set: { expiresAt: new Date(0) } },
      );
    expect(await applyTrustedSecondFactor(seeded.caller, headers)).toBe(false);
    expect(seeded.caller.session.authMethod).toBe("oauth");
  });
});

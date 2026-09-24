import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import {
  ProductSession,
  connectDatabase,
  disconnectDatabaseForTests,
  getDatabase,
} from "@xenode/database";

const mocks = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock("@/lib/realtime", () => ({
  publishProductSessionRevoked: mocks.publish,
}));

import { revokeIssuerProductsBeforeSessionDelete } from "../lib/issuer-session-revocation";
import { revokeProductSessions } from "../lib/logout-coordinator";

const origin = "https://accounts.example.test";
const priorUri = process.env.MONGODB_URI;
let server: MongoMemoryReplSet;
let auth: ReturnType<typeof makeAuth>;

function makeAuth() {
  return betterAuth({
    baseURL: origin,
    secret: "synthetic-issuer-revocation-secret-00001",
    database: mongodbAdapter(
      getDatabase() as unknown as Parameters<typeof mongodbAdapter>[0],
      { usePlural: false, transaction: false },
    ),
    emailAndPassword: { enabled: true },
    databaseHooks: {
      session: {
        delete: {
          before: revokeIssuerProductsBeforeSessionDelete,
        },
      },
    },
  });
}

async function createIssuer() {
  const signup = await auth.api.signUpEmail({
    body: {
      email: `${crypto.randomUUID()}@example.test`,
      name: "Synthetic account",
      password: "synthetic-login-password-123",
    },
    headers: new Headers({ origin }),
  });
  const raw = await getDatabase()
    .collection("session")
    .findOne({ token: signup.token });
  if (!raw || !signup.token)
    throw new Error("Better Auth did not create the issuer session");
  return {
    accountId: signup.user.id,
    issuerSessionId: String(raw._id),
    token: signup.token,
  };
}

async function createProductSession(input: {
  accountId: string;
  issuerSessionId: string;
  productId: "drive" | "photos";
}) {
  const sessionId = crypto.randomUUID();
  await ProductSession.create({
    ...input,
    sessionId,
    clientId: `xenode-${input.productId}-web`,
    authenticatedAt: new Date(),
    sessionVersion: 1,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return sessionId;
}

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = server.getUri();
  await connectDatabase();
  await ProductSession.init();
  auth = makeAuth();
});

beforeEach(() => {
  mocks.publish.mockReset().mockResolvedValue(true);
});

afterEach(async () => {
  for (const collection of await getDatabase().collections()) {
    await collection.deleteMany({});
  }
});

afterAll(async () => {
  await disconnectDatabaseForTests();
  await server.stop();
  if (priorUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = priorUri;
});

describe("Better Auth issuer-session deletion", () => {
  it("revokes only Drive and Photos sessions minted by the deleted issuer", async () => {
    const issuer = await createIssuer();
    const drive = await createProductSession({
      accountId: issuer.accountId,
      issuerSessionId: issuer.issuerSessionId,
      productId: "drive",
    });
    const photos = await createProductSession({
      accountId: issuer.accountId,
      issuerSessionId: issuer.issuerSessionId,
      productId: "photos",
    });
    const unrelated = await createProductSession({
      accountId: issuer.accountId,
      issuerSessionId: "another-issuer",
      productId: "drive",
    });
    const anotherAccount = await createProductSession({
      accountId: "another-account",
      issuerSessionId: issuer.issuerSessionId,
      productId: "photos",
    });

    const context = await auth.$context;
    await context.internalAdapter.deleteSession(issuer.token);

    expect(await ProductSession.countDocuments({
      sessionId: { $in: [drive, photos] },
      revokedAt: { $exists: true },
    })).toBe(2);
    expect(await ProductSession.exists({
      sessionId: unrelated,
      revokedAt: { $exists: false },
    })).toBeTruthy();
    expect(await ProductSession.exists({
      sessionId: anotherAccount,
      revokedAt: { $exists: false },
    })).toBeTruthy();
    expect(mocks.publish).toHaveBeenCalledTimes(2);
  });

  it("runs the hook for every issuer in a bulk account revocation", async () => {
    const issuer = await createIssuer();
    const context = await auth.$context;
    const second = await context.internalAdapter.createSession(issuer.accountId);
    if (!second) throw new Error("Better Auth did not create another session");
    const firstProduct = await createProductSession({
      accountId: issuer.accountId,
      issuerSessionId: issuer.issuerSessionId,
      productId: "drive",
    });
    const secondProduct = await createProductSession({
      accountId: issuer.accountId,
      issuerSessionId: second.id,
      productId: "photos",
    });

    await context.internalAdapter.deleteUserSessions(issuer.accountId);

    expect(await ProductSession.countDocuments({
      sessionId: { $in: [firstProduct, secondProduct] },
      revokedAt: { $exists: true },
    })).toBe(2);
    expect(mocks.publish).toHaveBeenCalledTimes(2);
  });

  it("increments a product session version only once under concurrent revocation", async () => {
    const issuer = await createIssuer();
    const sessionId = await createProductSession({
      accountId: issuer.accountId,
      issuerSessionId: issuer.issuerSessionId,
      productId: "drive",
    });
    await Promise.all([
      revokeProductSessions({
        accountId: issuer.accountId,
        issuerSessionId: issuer.issuerSessionId,
        action: "browser_logout",
      }),
      revokeProductSessions({
        accountId: issuer.accountId,
        issuerSessionId: issuer.issuerSessionId,
        action: "issuer_session_revoked",
      }),
    ]);
    const product = await ProductSession.findOne({ sessionId }).lean();
    expect(product?.sessionVersion).toBe(2);
    expect(product?.revokedAt).toBeInstanceOf(Date);
  });
});

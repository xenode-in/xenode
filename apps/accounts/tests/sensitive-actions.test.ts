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
  RateLimitWindow,
  connectDatabase,
  consumeRateLimit,
  disconnectDatabaseForTests,
  getDatabase,
} from "@xenode/database";

const mocks = vi.hoisted(() => ({
  getAccountsSession: vi.fn(),
  getSession: vi.fn(),
  verifyPassword: vi.fn(),
  setPassword: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  getAccountsSession: mocks.getAccountsSession,
}));
vi.mock("@/lib/auth", () => ({
  getAccountsAuth: async () => ({
    api: {
      getSession: mocks.getSession,
      verifyPassword: mocks.verifyPassword,
      setPassword: mocks.setPassword,
    },
  }),
}));

import {
  authorizeAccountsApiRequest,
  authorizeNativeAuthGet,
  authorizeNativeAuthPost,
} from "../lib/api-session";
import {
  ACCOUNTS_RATE_LIMITS,
  RECENT_AUTH_MAX_AGE_MS,
  isRecentlyAuthenticated,
} from "../lib/sensitive-actions";
import { POST as attachPassword } from "../app/api/account/password/route";
import { DELETE as revokeTrustedBrowsers } from "../app/api/account/two-factor/trusted/route";

const origin = "https://accounts.example.test";
const previous = process.env.MONGODB_URI;
const previousOrigin = process.env.ACCOUNTS_ORIGIN;
let server: MongoMemoryReplSet;

function session(ageMs: number, overrides: Record<string, unknown> = {}) {
  return {
    user: { id: "account-1", twoFactorEnabled: true },
    session: {
      id: "session-1",
      createdAt: new Date(Date.now() - ageMs),
      twoFactorVerifiedAt: new Date(),
      ...overrides,
    },
  };
}

function request(path: string, method: string, body?: unknown) {
  return new Request(`${origin}${path}`, {
    method,
    headers: { origin, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = server.getUri();
  process.env.ACCOUNTS_ORIGIN = origin;
  await connectDatabase();
  await RateLimitWindow.init();
}, 120_000);

beforeEach(() => {
  vi.resetAllMocks();
  const fresh = session(60_000);
  mocks.getAccountsSession.mockResolvedValue(fresh);
  mocks.getSession.mockResolvedValue(fresh);
});

afterEach(async () => {
  await RateLimitWindow.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabaseForTests();
  await server.stop();
  if (previous === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = previous;
  if (previousOrigin === undefined) delete process.env.ACCOUNTS_ORIGIN;
  else process.env.ACCOUNTS_ORIGIN = previousOrigin;
});

describe("fixed-window rate limits", () => {
  const rule = { bucket: "test:bucket", limit: 5, windowMs: 60_000 };

  it("allows the limit, then denies until the window rolls over", async () => {
    const now = new Date("2026-10-04T10:00:10.000Z");
    const decisions = [];
    for (let index = 0; index < 6; index += 1) {
      decisions.push(await consumeRateLimit(rule, "subject-1", now));
    }
    expect(decisions.map((decision) => decision.allowed)).toEqual([
      true, true, true, true, true, false,
    ]);
    expect(decisions[5].retryAfterSeconds).toBe(50);
    expect((await consumeRateLimit(rule, "subject-2", now)).allowed).toBe(true);
    expect(
      (await consumeRateLimit(rule, "subject-1", new Date("2026-10-04T10:01:00.000Z")))
        .allowed,
    ).toBe(true);
  });

  it("never admits more than the limit under concurrency", async () => {
    const now = new Date("2026-10-04T11:00:00.000Z");
    const decisions = await Promise.all(
      Array.from({ length: 25 }, () => consumeRateLimit(rule, "racer", now)),
    );
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
  });

  it("rejects malformed rules instead of disabling the limit", async () => {
    await expect(
      consumeRateLimit({ ...rule, limit: 0 }, "subject"),
    ).rejects.toThrow("Invalid rate limit rule");
    await expect(consumeRateLimit(rule, "")).rejects.toThrow(
      "Invalid rate limit rule",
    );
  });
});

describe("sensitive Accounts API policy", () => {
  it("measures recent authentication from the session's creation", () => {
    expect(isRecentlyAuthenticated({ createdAt: new Date() })).toBe(true);
    expect(
      isRecentlyAuthenticated({
        createdAt: new Date(Date.now() - RECENT_AUTH_MAX_AGE_MS - 1000),
      }),
    ).toBe(false);
    expect(
      isRecentlyAuthenticated({ createdAt: new Date(Date.now() + 60_000) }),
    ).toBe(false);
    expect(isRecentlyAuthenticated({ createdAt: null })).toBe(false);
  });

  it("requires recent authentication only when the route asks for it", async () => {
    mocks.getAccountsSession.mockResolvedValue(session(11 * 60_000));
    const stale = await authorizeAccountsApiRequest(
      request("/api/vault/devices", "POST"),
      { recentAuth: true },
    );
    expect(stale?.status).toBe(403);
    expect(await stale?.json()).toMatchObject({ code: "recent_auth_required" });
    expect(
      await authorizeAccountsApiRequest(request("/api/vault/devices", "DELETE")),
    ).toBeNull();
  });

  it("spends a per-account budget and reports when to retry", async () => {
    const policy = { rateLimit: ACCOUNTS_RATE_LIMITS.password };
    for (let attempt = 0; attempt < ACCOUNTS_RATE_LIMITS.password.limit; attempt += 1) {
      expect(
        await authorizeAccountsApiRequest(
          request("/api/account/password", "POST"),
          policy,
        ),
      ).toBeNull();
    }
    const limited = await authorizeAccountsApiRequest(
      request("/api/account/password", "POST"),
      policy,
    );
    expect(limited?.status).toBe(429);
    expect(Number(limited?.headers.get("retry-after"))).toBeGreaterThan(0);

    mocks.getAccountsSession.mockResolvedValue({
      ...session(60_000),
      user: { id: "account-2", twoFactorEnabled: false },
    });
    expect(
      await authorizeAccountsApiRequest(
        request("/api/account/password", "POST"),
        policy,
      ),
    ).toBeNull();
  });

  it("does not spend budget for unauthenticated or pending sessions", async () => {
    const policy = { rateLimit: ACCOUNTS_RATE_LIMITS.password };
    mocks.getAccountsSession.mockResolvedValue(null);
    expect(
      (await authorizeAccountsApiRequest(request("/api/account/password", "POST"), policy))
        ?.status,
    ).toBe(401);
    mocks.getAccountsSession.mockResolvedValue(
      session(60_000, { twoFactorVerifiedAt: null }),
    );
    expect(
      (await authorizeAccountsApiRequest(request("/api/account/password", "POST"), policy))
        ?.status,
    ).toBe(403);
    expect(await RateLimitWindow.countDocuments({})).toBe(0);
  });

  it("stops the sign-in password oracle with recent auth and the password budget", async () => {
    mocks.getAccountsSession.mockResolvedValue(session(11 * 60_000));
    const stale = await attachPassword(
      request("/api/account/password", "POST", { password: "x".repeat(16) }),
    );
    expect(stale.status).toBe(403);
    expect(mocks.verifyPassword).not.toHaveBeenCalled();

    // An account that already has a password: each attempt checks a guess.
    await getDatabase().collection("account").insertOne({
      userId: "account-1",
      providerId: "credential",
      password: "synthetic-hash",
    });
    mocks.getAccountsSession.mockResolvedValue(session(60_000));
    mocks.verifyPassword.mockRejectedValue(new Error("Invalid password"));
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      statuses.push(
        (
          await attachPassword(
            request("/api/account/password", "POST", {
              password: `guess-${attempt}-padding`,
            }),
          )
        ).status,
      );
    }
    expect(statuses).toEqual([400, 400, 400, 400, 400, 429, 429]);
    expect(mocks.verifyPassword).toHaveBeenCalledTimes(5);
    await getDatabase().collection("account").deleteMany({});
  });

  it("keeps protective revocation available to stale sessions", async () => {
    const stale = session(60 * 60_000);
    mocks.getAccountsSession.mockResolvedValue(stale);
    mocks.getSession.mockResolvedValue(stale);
    expect(
      (await revokeTrustedBrowsers(request("/api/account/two-factor/trusted", "DELETE")))
        .status,
    ).toBe(200);
  });
});

describe("native Better Auth sensitive endpoints", () => {
  it.each([
    ["POST", "/api/auth/passkey/verify-registration"],
    ["POST", "/api/auth/passkey/delete-passkey"],
    ["POST", "/api/auth/link-social"],
    ["POST", "/api/auth/unlink-account"],
    ["GET", "/api/auth/passkey/generate-register-options"],
  ])("requires recent authentication for %s %s", async (method, path) => {
    const guard = method === "GET" ? authorizeNativeAuthGet : authorizeNativeAuthPost;
    mocks.getAccountsSession.mockResolvedValue(session(11 * 60_000));
    expect((await guard(request(path, method)))?.status).toBe(403);
    mocks.getAccountsSession.mockResolvedValue(session(60_000));
    expect(await guard(request(path, method))).toBeNull();
  });

  it("lets a pending session finish authentication with a passkey", async () => {
    mocks.getAccountsSession.mockResolvedValue(
      session(60_000, { twoFactorVerifiedAt: null }),
    );
    expect(
      await authorizeNativeAuthGet(
        request("/api/auth/passkey/generate-authenticate-options", "GET"),
      ),
    ).toBeNull();
    expect(
      await authorizeNativeAuthPost(
        request("/api/auth/passkey/verify-authentication", "POST"),
      ),
    ).toBeNull();
    expect(mocks.getAccountsSession).not.toHaveBeenCalled();
  });
});

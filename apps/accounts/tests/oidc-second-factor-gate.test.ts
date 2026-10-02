import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { mongo } from "mongoose";
import {
  AccountProfile,
  UserVault,
  connectDatabase,
  disconnectDatabaseForTests,
  getDatabase,
} from "@xenode/database";
import {
  generateAccountRootKey,
  sealEnvelope,
  type EnvelopeType,
} from "@xenode/crypto-core";

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: vi.fn() };
  },
}));

import { getAccountsAuth } from "../lib/auth";
import {
  GET as nativeGet,
  POST as nativePost,
} from "../app/api/auth/[...all]/route";
import { POST as stepUp } from "../app/api/account/two-factor/verify/route";
import { GET as postLogin } from "../app/auth/post-login/route";
import {
  VAULT_UNLOCK_COOKIE,
  createVaultUnlockToken,
} from "../lib/vault-unlock-session";
import { secondFactorSessionFields } from "../lib/second-factor-policy";

// Drives the production Better Auth configuration (plugin order, hooks and
// OAuth provider) with real TOTP codes. Only the email transport is mocked.
const origin = "https://accounts.example.test";
const driveOrigin = "https://drive.example.test";
const redirectUri = `${driveOrigin}/auth/callback`;
const password = "synthetic-sign-in-password-123";
const previousEnv = Object.fromEntries(
  [
    "MONGODB_URI",
    "ACCOUNTS_ORIGIN",
    "DRIVE_ORIGIN",
    "PHOTOS_ORIGIN",
    "BETTER_AUTH_SECRET",
  ].map((name) => [name, process.env[name]]),
);
let server: MongoMemoryReplSet;

class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attributes] = cookie.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const maxAge = attributes
        .map((attribute) => attribute.trim().toLowerCase())
        .find((attribute) => attribute.startsWith("max-age="));
      if (!value || (maxAge && Number(maxAge.slice(8)) <= 0)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  set(name: string, value: string) {
    this.cookies.set(name, value);
  }

  without(fragment: string) {
    const copy = new CookieJar();
    for (const [name, value] of this.cookies) {
      if (!name.includes(fragment)) copy.set(name, value);
    }
    return copy;
  }

  names() {
    return [...this.cookies.keys()];
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

async function call(
  handler: (request: Request) => Promise<Response> | Response,
  path: string,
  jar: CookieJar,
  init: { body?: unknown; headers?: Record<string, string> } = {},
) {
  const headers = new Headers({ origin, ...init.headers });
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await handler(
    new Request(`${origin}${path}`, {
      method: init.body === undefined ? "GET" : "POST",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
  jar.absorb(response);
  return response;
}

function base32Bytes(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let bits = 0;
  let buffer = 0;
  for (const character of value.replace(/=+$/u, "").toUpperCase()) {
    buffer = ((buffer << 5) | alphabet.indexOf(character)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), as Better Auth verifies it. */
function totp(secret: Buffer) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(
    6,
    "0",
  );
}

function authorizePath() {
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    client_id: "xenode-drive-web",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email",
    state: "synthetic-state",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return `/api/auth/oauth2/authorize?${query}`;
}

async function envelope(accountId: string, type: EnvelopeType, keyId: string) {
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

async function sessionsFor(accountId: string) {
  return getDatabase()
    .collection("session")
    .find({ userId: { $in: [accountId, new mongo.ObjectId(accountId)] } })
    .sort({ createdAt: 1 })
    .toArray();
}

/** Real sign-up, password sign-in, TOTP enrollment and completed onboarding. */
async function enrolledAccount() {
  const email = `${randomUUID()}@example.test`;
  const jar = new CookieJar();
  expect(
    (
      await call(nativePost, "/api/auth/sign-up/email", jar, {
        body: { email, password, name: "Synthetic account" },
      })
    ).status,
  ).toBe(200);
  await getDatabase()
    .collection("user")
    .updateOne({ email }, { $set: { emailVerified: true } });
  expect(
    (
      await call(nativePost, "/api/auth/sign-in/email", jar, {
        body: { email, password },
      })
    ).status,
  ).toBe(200);
  const enabled = await call(nativePost, "/api/auth/two-factor/enable", jar, {
    body: { password },
  });
  expect(enabled.status).toBe(200);
  const { totpURI } = (await enabled.json()) as { totpURI: string };
  const secret = base32Bytes(new URL(totpURI).searchParams.get("secret") ?? "");
  expect(
    (
      await call(nativePost, "/api/auth/two-factor/verify-totp", jar, {
        body: { code: totp(secret) },
      })
    ).status,
  ).toBe(200);
  const user = await getDatabase().collection("user").findOne({ email });
  expect(user?.twoFactorEnabled).toBe(true);
  const accountId = String(user?._id);
  await AccountProfile.create({ accountId, onboarded: true });
  await UserVault.create({
    accountId,
    vaultRevision: 1,
    formatVersion: 2,
    passwordMode: "separate",
    passwordEnvelope: await envelope(accountId, "password", "ark"),
    recoveryEnvelope: await envelope(accountId, "recovery", "ark"),
    wrappedSharingPrivateKey: await envelope(
      accountId,
      "sharing-private-key",
      "sharing-private-key",
    ),
    sharingPublicKey: "synthetic-sharing-public-key",
    deviceEnvelopes: [],
  });
  return { email, accountId, secret, jar };
}

async function unlock(jar: CookieJar, accountId: string) {
  const [session] = (await sessionsFor(accountId)).slice(-1);
  jar.set(
    VAULT_UNLOCK_COOKIE,
    await createVaultUnlockToken({ accountId, sessionId: String(session._id) }),
  );
  return session;
}

function issuedCode(response: Response, body: string) {
  return (
    (response.headers.get("location") ?? "").includes("code=") ||
    body.includes("code=")
  );
}

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  Object.assign(process.env, {
    MONGODB_URI: server.getUri(),
    ACCOUNTS_ORIGIN: origin,
    DRIVE_ORIGIN: driveOrigin,
    PHOTOS_ORIGIN: "https://photos.example.test",
    BETTER_AUTH_SECRET: "synthetic-oidc-second-factor-gate-secret-0001",
  });
  await connectDatabase();
  await getAccountsAuth();
}, 120_000);

afterEach(async () => {
  for (const name of ["user", "session", "account", "twoFactor", "verification"]) {
    await getDatabase().collection(name).deleteMany({});
  }
  await AccountProfile.deleteMany({});
  await UserVault.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabaseForTests();
  await server.stop();
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("OIDC authorization second-factor gate", () => {
  it.each([
    ["navigation", { "sec-fetch-mode": "navigate", accept: "text/html" }],
    ["fetch", { accept: "application/json" }],
  ])(
    "issues no code when a two-factor account signs in with a password and an OAuth query (%s)",
    async (_mode, headers) => {
      const { email } = await enrolledAccount();
      const anonymous = new CookieJar();
      const login = await call(nativeGet, authorizePath(), anonymous);
      expect(login.status).toBe(302);
      const signedQuery = new URL(
        login.headers.get("location") ?? "",
        origin,
      ).search.slice(1);
      expect(signedQuery).toContain("sig=");

      const response = await call(nativePost, "/api/auth/sign-in/email", anonymous, {
        body: { email, password, oauth_query: signedQuery },
        headers,
      });
      const body = await response.text();
      expect(issuedCode(response, body)).toBe(false);
      expect(JSON.parse(body)).toMatchObject({ twoFactorRedirect: true });
      expect(anonymous.names().some((name) => name.includes("session_token"))).toBe(
        false,
      );
    },
  );

  it("routes a pending session through step-up before any authorization path issues a code", async () => {
    const { accountId, secret, jar } = await enrolledAccount();
    const session = await unlock(jar, accountId);
    // The session a social callback creates for a two-factor account.
    await getDatabase()
      .collection("session")
      .updateOne(
        { _id: session._id },
        { $set: { authMethod: "oauth", twoFactorVerifiedAt: null } },
      );

    // The plugin's own authorize (as reached in-process after a callback)
    // must defer to the gate instead of issuing a code.
    const auth = await getAccountsAuth();
    const inProcess = await call(auth.handler, authorizePath(), jar);
    expect(inProcess.status).toBe(302);
    const deferred = inProcess.headers.get("location") ?? "";
    expect(deferred).toContain("/auth/post-login?");
    expect(issuedCode(inProcess, await inProcess.text())).toBe(false);

    const deferredUrl = new URL(deferred, origin);
    const resumed = await call(
      postLogin,
      deferredUrl.pathname + deferredUrl.search,
      jar,
    );
    expect(resumed.status).toBe(303);
    const resumeTarget = new URL(resumed.headers.get("location") ?? "");
    expect(resumeTarget.origin).toBe(origin);
    expect(resumeTarget.pathname).toBe("/api/auth/oauth2/authorize");

    const gated = await call(
      nativeGet,
      resumeTarget.pathname + resumeTarget.search,
      jar,
    );
    expect(gated.status).toBe(302);
    expect(gated.headers.get("location")).toContain("/two-factor?next=");

    expect((await call(nativeGet, "/api/auth/list-sessions", jar)).status).toBe(403);
    expect(
      (
        await call(nativePost, "/api/auth/two-factor/verify-totp", jar, {
          body: { code: totp(secret) },
        })
      ).status,
    ).toBe(403);
    expect(
      (await getDatabase().collection("session").findOne({ _id: session._id }))
        ?.twoFactorVerifiedAt,
    ).toBeNull();

    expect(
      (
        await call(stepUp, "/api/account/two-factor/verify", jar, {
          body: { code: totp(secret), method: "totp", trustDevice: false },
        })
      ).status,
    ).toBe(200);
    expect(
      (await getDatabase().collection("session").findOne({ _id: session._id }))
        ?.twoFactorVerifiedAt,
    ).toBeInstanceOf(Date);

    const authorized = await call(nativeGet, authorizePath(), jar);
    expect(authorized.status).toBe(302);
    const callback = new URL(authorized.headers.get("location") ?? "");
    expect(`${callback.origin}${callback.pathname}`).toBe(redirectUri);
    expect(callback.searchParams.get("code")).toBeTruthy();
    expect(callback.searchParams.get("state")).toBe("synthetic-state");
  });

  it("keeps Better Auth trusted-device credential sign-ins verified and challenges others", async () => {
    const { email, accountId, secret } = await enrolledAccount();
    const browser = new CookieJar();
    const challenged = await call(nativePost, "/api/auth/sign-in/email", browser, {
      body: { email, password },
    });
    expect(await challenged.json()).toMatchObject({ twoFactorRedirect: true });

    const verified = await call(stepUp, "/api/account/two-factor/verify", browser, {
      body: { code: totp(secret), method: "totp", trustDevice: true },
    });
    expect(verified.status).toBe(200);
    const challengeSession = (await sessionsFor(accountId)).at(-1);
    expect(challengeSession?.authMethod).toBe("totp");
    expect(challengeSession?.twoFactorVerifiedAt).toBeInstanceOf(Date);
    expect(browser.names().some((name) => name.includes("trust_device"))).toBe(true);

    const returning = browser.without("session_token");
    const trusted = await call(nativePost, "/api/auth/sign-in/email", returning, {
      body: { email, password },
    });
    expect(await trusted.json()).not.toHaveProperty("twoFactorRedirect");
    const trustedSession = (await sessionsFor(accountId)).at(-1);
    expect(trustedSession?.authMethod).toBe("trusted-device");
    expect(trustedSession?.twoFactorVerifiedAt).toBeInstanceOf(Date);

    const stranger = await call(nativePost, "/api/auth/sign-in/email", new CookieJar(), {
      body: { email, password },
    });
    expect(await stranger.json()).toMatchObject({ twoFactorRedirect: true });
  });

  it("marks only second-factor sessions verified for two-factor accounts", async () => {
    const [enabled, disabled] = await Promise.all(
      [true, false].map(async (twoFactorEnabled) =>
        String(
          (
            await getDatabase()
              .collection("user")
              .insertOne({ email: `${randomUUID()}@example.test`, twoFactorEnabled })
          ).insertedId,
        ),
      ),
    );
    const now = new Date();
    for (const [path, method] of [
      ["/callback/google", "oauth"],
      ["/email-otp/verify-email", "email-otp"],
      ["/sign-in/email", "password"],
      ["", "password"],
    ] as const) {
      expect(
        await secondFactorSessionFields({ accountId: enabled, path, now }),
      ).toEqual({ authMethod: method, twoFactorVerifiedAt: null });
      expect(
        await secondFactorSessionFields({ accountId: disabled, path, now }),
      ).toEqual({ authMethod: method, twoFactorVerifiedAt: now });
    }
    for (const [path, method] of [
      ["/passkey/verify-authentication", "passkey"],
      ["/two-factor/verify-totp", "totp"],
    ] as const) {
      expect(
        await secondFactorSessionFields({ accountId: enabled, path, now }),
      ).toEqual({ authMethod: method, twoFactorVerifiedAt: now });
    }
  });

  it("resumes post-login only through the same-origin authorize endpoint", async () => {
    const response = await postLogin(
      new Request(
        `${origin}/auth/post-login?client_id=xenode-drive-web&state=s&next=https%3A%2F%2Fattacker.test&redirect=https%3A%2F%2Fattacker.test`,
      ),
    );
    expect(response.status).toBe(303);
    const target = new URL(response.headers.get("location") ?? "");
    expect(target.origin).toBe(origin);
    expect(target.pathname).toBe("/api/auth/oauth2/authorize");
    expect([...target.searchParams.keys()]).toEqual(["client_id", "state"]);
  });
});

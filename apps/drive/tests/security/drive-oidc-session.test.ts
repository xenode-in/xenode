import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { ProductSession } from "@xenode/database";

/**
 * Drive OIDC callback + ProductSession security contract (R1 groundwork).
 *
 * The callback is exercised with a REAL RS256 keypair: the mocked fetch
 * serves both the Accounts token endpoint and the JWKS, so jose's jwtVerify
 * genuinely validates issuer, audience, signature, and expiry — nothing in
 * the verification path is stubbed out.
 */

const ISSUER = "https://accounts.test";
const ORIGIN = "https://drive.test";

const { jar } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    jar: {
      store,
      get: (name: string) =>
        store.has(name) ? { name, value: store.get(name)! } : undefined,
      set: (name: string, value: string) => void store.set(name, value),
      delete: (name: string) => void store.delete(name),
    },
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => jar,
}));

import { GET as callbackGET } from "@/app/auth/callback/route";
import { getDriveProductSession } from "@/lib/auth/product-session";

let privateKey: CryptoKey;
let jwks: { keys: object[] };

beforeAll(async () => {
  process.env.ACCOUNTS_ORIGIN = ISSUER;
  process.env.DRIVE_ORIGIN = ORIGIN;
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey as CryptoKey;
  const publicJwk = await exportJWK(pair.publicKey);
  jwks = { keys: [{ ...publicJwk, alg: "RS256", use: "sig", kid: "test-key" }] };
});

function seedFlowCookies() {
  jar.store.clear();
  jar.set("xenode_drive_oidc_state", "state-0123456789abcdef");
  jar.set("xenode_drive_oidc_nonce", "nonce-0123456789abcdef");
  jar.set(
    "xenode_drive_pkce",
    "verifier-0123456789abcdef-0123456789abcdef-0123456789",
  );
}

async function signIdToken(overrides: {
  iss?: string;
  aud?: string;
  nonce?: string;
  sub?: string;
  expiresIn?: string;
}) {
  return new SignJWT({
    nonce: overrides.nonce ?? "nonce-0123456789abcdef",
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? "xenode-drive-web")
    .setSubject(overrides.sub ?? "acct_1")
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? "5m")
    .sign(privateKey);
}

function mockAccountsFetch(idToken: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | RequestInfo) => {
      const target = String(input instanceof Request ? input.url : input);
      if (target.includes("/api/auth/oauth2/token")) {
        return new Response(
          JSON.stringify({ id_token: idToken, expires_in: 3600 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (target.includes("/api/auth/jwks")) {
        return new Response(JSON.stringify(jwks), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch: ${target}`);
    }),
  );
}

function callbackRequest(params: { code?: string; state?: string }) {
  const url = new URL(`${ORIGIN}/auth/callback`);
  if (params.code) url.searchParams.set("code", params.code);
  if (params.state) url.searchParams.set("state", params.state);
  return new Request(url);
}

describe("Drive OIDC callback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a tampered state parameter", async () => {
    seedFlowCookies();
    const response = await callbackGET(
      callbackRequest({ code: "code_1", state: "state-TAMPERED" }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid OIDC callback state",
    });
    expect(await ProductSession.countDocuments({ productId: "drive" })).toBe(0);
  });

  it("rejects a callback with no PKCE verifier cookie", async () => {
    seedFlowCookies();
    jar.delete("xenode_drive_pkce");
    const response = await callbackGET(
      callbackRequest({ code: "code_1", state: "state-0123456789abcdef" }),
    );
    expect(response.status).toBe(400);
    expect(await ProductSession.countDocuments({ productId: "drive" })).toBe(0);
  });

  it("rejects an id_token minted for another audience", async () => {
    seedFlowCookies();
    mockAccountsFetch(await signIdToken({ aud: "xenode-photos-web" }));
    const response = await callbackGET(
      callbackRequest({ code: "code_1", state: "state-0123456789abcdef" }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid OIDC token",
    });
    expect(await ProductSession.countDocuments({ productId: "drive" })).toBe(0);
  });

  it("rejects an id_token from another issuer", async () => {
    seedFlowCookies();
    mockAccountsFetch(await signIdToken({ iss: "https://evil.test" }));
    const response = await callbackGET(
      callbackRequest({ code: "code_1", state: "state-0123456789abcdef" }),
    );
    expect(response.status).toBe(400);
    expect(await ProductSession.countDocuments({ productId: "drive" })).toBe(0);
  });

  it("rejects an id_token whose nonce does not match the flow", async () => {
    seedFlowCookies();
    mockAccountsFetch(await signIdToken({ nonce: "nonce-REPLAYED-VALUE" }));
    const response = await callbackGET(
      callbackRequest({ code: "code_1", state: "state-0123456789abcdef" }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid OIDC token nonce",
    });
    expect(await ProductSession.countDocuments({ productId: "drive" })).toBe(0);
  });

  it("rejects an expired id_token", async () => {
    seedFlowCookies();
    mockAccountsFetch(await signIdToken({ expiresIn: "-5m" }));
    const response = await callbackGET(
      callbackRequest({ code: "code_1", state: "state-0123456789abcdef" }),
    );
    expect(response.status).toBe(400);
    expect(await ProductSession.countDocuments({ productId: "drive" })).toBe(0);
  });

  it("mints a Drive ProductSession + host-only cookie for a valid flow", async () => {
    seedFlowCookies();
    mockAccountsFetch(await signIdToken({}));
    const response = await callbackGET(
      callbackRequest({ code: "code_1", state: "state-0123456789abcdef" }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);

    const session = await ProductSession.findOne({ productId: "drive" }).lean();
    expect(session).toMatchObject({
      accountId: "acct_1",
      productId: "drive",
      sessionVersion: 1,
    });
    expect(jar.get("xenode_drive_session")?.value).toBe(session!.sessionId);
    // Single-use flow cookies are cleared.
    expect(jar.get("xenode_drive_oidc_state")).toBeUndefined();
    expect(jar.get("xenode_drive_oidc_nonce")).toBeUndefined();
    expect(jar.get("xenode_drive_pkce")).toBeUndefined();
  });
});

describe("Drive ProductSession resolution", () => {
  it("resolves a live session and rejects revoked/expired ones", async () => {
    jar.store.clear();

    await ProductSession.create({
      sessionId: "live-session",
      accountId: "acct_1",
      productId: "drive",
      authenticatedAt: new Date(),
      sessionVersion: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    jar.set("xenode_drive_session", "live-session");
    await expect(getDriveProductSession()).resolves.toMatchObject({
      sessionId: "live-session",
      accountId: "acct_1",
    });

    // Revocation blocks access immediately.
    await ProductSession.updateOne(
      { sessionId: "live-session" },
      { $set: { revokedAt: new Date() }, $inc: { sessionVersion: 1 } },
    );
    await expect(getDriveProductSession()).resolves.toBeNull();

    // Expired sessions never resolve.
    await ProductSession.create({
      sessionId: "expired-session",
      accountId: "acct_1",
      productId: "drive",
      authenticatedAt: new Date(Date.now() - 120_000),
      sessionVersion: 1,
      expiresAt: new Date(Date.now() - 60_000),
    });
    jar.set("xenode_drive_session", "expired-session");
    await expect(getDriveProductSession()).resolves.toBeNull();

    // A Photos session id must not unlock Drive.
    await ProductSession.create({
      sessionId: "photos-session",
      accountId: "acct_1",
      productId: "photos",
      authenticatedAt: new Date(),
      sessionVersion: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    jar.set("xenode_drive_session", "photos-session");
    await expect(getDriveProductSession()).resolves.toBeNull();

    // No cookie → no session.
    jar.delete("xenode_drive_session");
    await expect(getDriveProductSession()).resolves.toBeNull();
  });
});

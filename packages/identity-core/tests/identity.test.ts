import { describe, expect, it } from "vitest";
import {
  FIRST_PARTY_CLIENTS,
  buildOidcAuthorizationUrl,
  createOidcFlow,
  decodeProductSessionCookie,
  encodeProductSessionCookie,
  normalizeUsername,
  pkceS256,
  redeemAuthorizationCode,
  resolveFirstPartyClients,
  sanitizeReturnTo,
  validateAuthorizationRequest,
  validateIdTokenClaims,
  validateUsername,
} from "../src";

describe("identity authority contracts", () => {
  it("normalizes usernames and rejects reserved or malformed names", () => {
    expect(normalizeUsername("  Alice_1 ")).toBe("alice_1");
    expect(validateUsername("alice_1")).toBe(true);
    expect(validateUsername("Admin")).toBe(false);
    expect(validateUsername("two")).toBe(true);
    expect(validateUsername("bad-name")).toBe(false);
  });

  it("requires exact first-party redirect URI, state, nonce, and S256", async () => {
    const verifier = "v".repeat(48);
    const valid = {
      clientId: "xenode-photos-web",
      redirectUri: "https://photos.xenode.in/auth/callback",
      state: "s".repeat(16),
      nonce: "n".repeat(16),
      codeChallenge: await pkceS256(verifier),
      codeChallengeMethod: "S256" as const,
    };
    expect(validateAuthorizationRequest(valid).productId).toBe("photos");
    expect(() =>
      validateAuthorizationRequest({
        ...valid,
        redirectUri: "https://evil.example/callback",
      }),
    ).toThrow("Invalid");
    expect(FIRST_PARTY_CLIENTS).toHaveLength(3);
  });

  it("consumes authorization codes once and verifies PKCE", async () => {
    const verifier = "x".repeat(64);
    let consumed = false;
    const record = {
      code: "code_1",
      clientId: "xenode-photos-web",
      redirectUri: "https://photos.xenode.in/auth/callback",
      accountId: "acct_1",
      nonce: "n".repeat(16),
      codeChallenge: await pkceS256(verifier),
      expiresAt: new Date("2026-01-01T00:01:00Z"),
    };
    const store = {
      async consume() {
        if (consumed) return null;
        consumed = true;
        return record;
      },
    };
    await expect(
      redeemAuthorizationCode(
        {
          code: "code_1",
          clientId: record.clientId,
          redirectUri: record.redirectUri,
          verifier,
          now: new Date("2026-01-01T00:00:00Z"),
        },
        store,
      ),
    ).resolves.toEqual(record);
    await expect(
      redeemAuthorizationCode(
        {
          code: "code_1",
          clientId: record.clientId,
          redirectUri: record.redirectUri,
          verifier,
        },
        store,
      ),
    ).rejects.toThrow("consumed");
  });

  it("validates issuer, audience, nonce, and lifetime", () => {
    expect(() =>
      validateIdTokenClaims(
        {
          iss: "https://accounts.xenode.in",
          aud: "xenode-photos-web",
          sub: "acct_1",
          iat: 100,
          exp: 200,
          nonce: "nonce",
        },
        {
          issuer: "https://accounts.xenode.in",
          audience: "xenode-photos-web",
          nonce: "nonce",
          nowSeconds: 150,
        },
      ),
    ).not.toThrow();
  });

  it("extends web-client redirect allowlists with deployment origins only", async () => {
    const resolved = resolveFirstPartyClients({
      drive: "http://localhost:3000",
      photos: "https://staging-photos.xenode.in/some/path",
    });
    const drive = resolved.find((c) => c.clientId === "xenode-drive-web")!;
    const photos = resolved.find((c) => c.clientId === "xenode-photos-web")!;
    const mobile = resolved.find((c) => c.clientId === "xenode-mobile")!;

    // Static production URIs stay; the env origin's callback is appended.
    expect(drive.redirectUris).toEqual([
      "https://drive.xenode.in/auth/callback",
      "http://localhost:3000/auth/callback",
    ]);
    // Origins are normalized — path segments never widen the allowlist.
    expect(photos.redirectUris).toEqual([
      "https://photos.xenode.in/auth/callback",
      "https://staging-photos.xenode.in/auth/callback",
    ]);
    // Products without a supplied origin are untouched.
    expect(mobile.redirectUris).toEqual(["in.xenode.app://auth/callback"]);

    // Re-declaring the production origin dedupes instead of duplicating.
    const deduped = resolveFirstPartyClients({
      drive: "https://drive.xenode.in",
    });
    expect(
      deduped.find((c) => c.clientId === "xenode-drive-web")!.redirectUris,
    ).toEqual(["https://drive.xenode.in/auth/callback"]);

    // The registry itself is never mutated.
    expect(
      FIRST_PARTY_CLIENTS.find((c) => c.clientId === "xenode-drive-web")!
        .redirectUris,
    ).toEqual(["https://drive.xenode.in/auth/callback"]);

    // Non-URL and non-http(s) origins fail loudly.
    expect(() => resolveFirstPartyClients({ drive: "not a url" })).toThrow(
      /Invalid OIDC origin/u,
    );
    expect(() =>
      resolveFirstPartyClients({ drive: "javascript:alert(1)" }),
    ).toThrow(/Invalid OIDC origin/u);
  });

  it("preserves only same-origin return paths and never requests offline access", async () => {
    expect(sanitizeReturnTo("/dashboard/files?view=grid", "/dashboard")).toBe(
      "/dashboard/files?view=grid",
    );
    expect(sanitizeReturnTo("//evil.example/path", "/dashboard")).toBe(
      "/dashboard",
    );
    expect(
      sanitizeReturnTo("https://evil.example/path", "/dashboard"),
    ).toBe("/dashboard");
    const flow = await createOidcFlow("/dashboard", "/dashboard");
    const authorize = buildOidcAuthorizationUrl({
      issuer: "https://accounts.xenode.in",
      clientId: "xenode-drive-web",
      redirectUri: "https://drive.xenode.in/auth/callback",
      flow,
    });
    expect(authorize.searchParams.get("scope")).toBe("openid profile email");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("signs product cookies and rejects tampering and expiry", async () => {
    const secret = "a-secure-test-secret-with-at-least-32-bytes";
    const value = await encodeProductSessionCookie(
      {
        sessionId: "session_1",
        sessionVersion: 3,
        productId: "drive",
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      },
      secret,
    );
    await expect(
      decodeProductSessionCookie(value, secret),
    ).resolves.toMatchObject({
      sessionId: "session_1",
      sessionVersion: 3,
      productId: "drive",
    });
    await expect(
      decodeProductSessionCookie(`${value.slice(0, -1)}x`, secret),
    ).resolves.toBeNull();
    const expired = await encodeProductSessionCookie(
      {
        sessionId: "session_1",
        sessionVersion: 3,
        productId: "drive",
        expiresAt: Math.floor(Date.now() / 1000) - 1,
      },
      secret,
    );
    await expect(
      decodeProductSessionCookie(expired, secret),
    ).resolves.toBeNull();
  });
});

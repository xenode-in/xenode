import { describe, expect, it } from "vitest";
import {
  FIRST_PARTY_CLIENTS,
  normalizeUsername,
  pkceS256,
  redeemAuthorizationCode,
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
});

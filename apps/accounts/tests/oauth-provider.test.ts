import { describe, expect, it } from "vitest";
import { firstPartyIdTokenClaims } from "../lib/auth";

describe("Accounts OAuth provider claims", () => {
  it("binds an ID token to the registered first-party client", () => {
    expect(
      firstPartyIdTokenClaims({ authorizedParty: "xenode-drive-web" }),
    ).toEqual({ azp: "xenode-drive-web" });
  });

  it("fails closed when a client lacks authorized-party metadata", () => {
    expect(() => firstPartyIdTokenClaims()).toThrow(
      "OIDC client is missing its authorized party",
    );
  });
});

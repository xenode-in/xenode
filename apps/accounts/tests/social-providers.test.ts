import { describe, expect, it } from "vitest";
import { resolveSocialProviders } from "../lib/auth";

describe("Accounts social providers", () => {
  it("configures Google and GitHub with identity-only scopes", () => {
    const providers = resolveSocialProviders({
      GOOGLE_CLIENT_ID: " google-id ",
      GOOGLE_CLIENT_SECRET: " google-secret ",
      GITHUB_CLIENT_ID: " github-id ",
      GITHUB_CLIENT_SECRET: " github-secret ",
    });

    expect(providers.google?.scope).toEqual(["openid", "email", "profile"]);
    expect(providers.github?.scope).toEqual(["read:user", "user:email"]);
    expect(providers.github?.clientId).toBe("github-id");
  });

  it("omits partially configured providers", () => {
    expect(
      resolveSocialProviders({
        GOOGLE_CLIENT_ID: "id-without-secret",
        GITHUB_CLIENT_SECRET: "secret-without-id",
      }),
    ).toEqual({});
  });
});

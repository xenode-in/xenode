import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createVaultUnlockToken,
  hasVaultUnlockConfirmation,
  VAULT_UNLOCK_COOKIE,
} from "../lib/vault-unlock-session";

const originalSecret = process.env.BETTER_AUTH_SECRET;
const originalOrigin = process.env.ACCOUNTS_ORIGIN;

describe("Vault unlock confirmation", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET =
      "test-only-vault-unlock-secret-that-is-long-enough";
    process.env.ACCOUNTS_ORIGIN = "https://accounts.example.test";
  });

  afterEach(() => {
    process.env.BETTER_AUTH_SECRET = originalSecret;
    process.env.ACCOUNTS_ORIGIN = originalOrigin;
  });

  it("binds the confirmation to both account and Accounts session", async () => {
    const token = await createVaultUnlockToken({
      accountId: "account-1",
      sessionId: "session-1",
    });
    const headers = new Headers({
      cookie: `${VAULT_UNLOCK_COOKIE}=${encodeURIComponent(token)}`,
    });

    await expect(
      hasVaultUnlockConfirmation(headers, {
        accountId: "account-1",
        sessionId: "session-1",
      }),
    ).resolves.toBe(true);
    await expect(
      hasVaultUnlockConfirmation(headers, {
        accountId: "account-1",
        sessionId: "session-2",
      }),
    ).resolves.toBe(false);
    await expect(
      hasVaultUnlockConfirmation(headers, {
        accountId: "account-2",
        sessionId: "session-1",
      }),
    ).resolves.toBe(false);
  });

  it("rejects a forged confirmation", async () => {
    const headers = new Headers({
      cookie: `${VAULT_UNLOCK_COOKIE}=not-a-valid-token`,
    });
    await expect(
      hasVaultUnlockConfirmation(headers, {
        accountId: "account-1",
        sessionId: "session-1",
      }),
    ).resolves.toBe(false);
  });
});

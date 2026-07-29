import { connectDatabase, getDatabase } from "../connection";
import { AccountProfile, UserVault } from "../models";
import { createAccountRepository } from "./accounts";

export * from "./accounts";
export * from "./browser-logout";
export * from "./types";

export async function listExternalAccountsForUser(userId: string) {
  await connectDatabase();
  return createAccountRepository(getDatabase()).listForUser(userId);
}

export interface AccountOnboardingReadiness {
  profileOnboarded: boolean;
  hasVault: boolean;
  hasPasswordEnvelope: boolean;
  hasPasswordCredential: boolean;
  complete: boolean;
}

/**
 * Canonical gate for issuing or accepting first-party product sessions.
 *
 * Authentication alone is intentionally insufficient: a user must also have
 * completed their Accounts profile and have both sides of the coordinated
 * password setup (the Better Auth credential and the password-wrapped ARK).
 */
export async function getAccountOnboardingReadiness(
  accountId: string,
): Promise<AccountOnboardingReadiness> {
  await connectDatabase();
  const [profile, vault, accounts] = await Promise.all([
    AccountProfile.findOne({ accountId }).select("onboarded").lean(),
    UserVault.findOne({ accountId }).select("passwordEnvelope").lean(),
    createAccountRepository(getDatabase()).listForUser(accountId),
  ]);
  const hasPasswordCredential = accounts.some(
    (account) =>
      account.providerId === "credential" &&
      typeof account.password === "string" &&
      account.password.length > 0,
  );
  const profileOnboarded = profile?.onboarded === true;
  const hasVault = Boolean(vault);
  const hasPasswordEnvelope = Boolean(vault?.passwordEnvelope);

  return {
    profileOnboarded,
    hasVault,
    hasPasswordEnvelope,
    hasPasswordCredential,
    complete:
      profileOnboarded &&
      hasVault &&
      hasPasswordEnvelope &&
      hasPasswordCredential,
  };
}

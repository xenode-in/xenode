import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { jwt, oidcProvider, username } from "better-auth/plugins";
import { connectDatabase, getDatabase } from "@xenode/database";
import {
  FIRST_PARTY_CLIENTS,
  validateUsername,
} from "@xenode/identity-core";

async function createAccountsAuth() {
  await connectDatabase();
  return betterAuth({
      appName: "Xenode Accounts",
      baseURL: process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in",
      secret: process.env.BETTER_AUTH_SECRET,
      database: mongodbAdapter(
        getDatabase() as unknown as Parameters<typeof mongodbAdapter>[0],
        { usePlural: false, transaction: false },
      ),
      emailAndPassword: { enabled: true },
      advanced: {
        cookiePrefix: "xenode_accounts",
        crossSubDomainCookies: { enabled: false },
      },
      plugins: [
        username({
          minUsernameLength: 3,
          maxUsernameLength: 30,
          usernameNormalization: (value) => value.trim().toLowerCase(),
          usernameValidator: validateUsername,
          validationOrder: { username: "post-normalization" },
        }),
        jwt(),
        oidcProvider({
          loginPage: "/login",
          consentPage: "/oauth/authorize",
          allowDynamicClientRegistration: false,
          requirePKCE: true,
          allowPlainCodeChallengeMethod: false,
          useJWTPlugin: true,
          codeExpiresIn: 300,
          scopes: ["openid", "profile", "email", "offline_access"],
          trustedClients: FIRST_PARTY_CLIENTS.map((client) => ({
            clientId: client.clientId,
            type: "public" as const,
            name: client.clientId,
            metadata: null,
            disabled: false,
            redirectUrls: [...client.redirectUris],
            skipConsent: true,
          })),
        }),
      ],
    });
}

let authPromise: ReturnType<typeof createAccountsAuth> | undefined;

export function getAccountsAuth() {
  authPromise ??= createAccountsAuth();
  return authPromise;
}

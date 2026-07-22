import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { jwt, oidcProvider, username } from "better-auth/plugins";
import { AuditEvent, connectDatabase, getDatabase } from "@xenode/database";
import {
  resolveFirstPartyClients,
  validateUsername,
} from "@xenode/identity-core";

async function createAccountsAuth() {
  await connectDatabase();
  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return betterAuth({
      appName: "Xenode Accounts",
      baseURL: process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in",
      secret: process.env.BETTER_AUTH_SECRET,
      database: mongodbAdapter(
        getDatabase() as unknown as Parameters<typeof mongodbAdapter>[0],
        { usePlural: false, transaction: false },
      ),
      emailAndPassword: { enabled: true },
      socialProviders:
        googleClientId && googleClientSecret
          ? {
              google: {
                clientId: googleClientId,
                clientSecret: googleClientSecret,
                scope: [
                  "openid",
                  "email",
                  "profile",
                ],
              },
            }
          : {},
      account: {
        accountLinking: {
          enabled: true,
          allowDifferentEmails: false,
          allowUnlinkingAll: false,
        },
      },
      databaseHooks: {
        session: {
          create: {
            async after(session, context) {
              await AuditEvent.create({
                accountId: session.userId,
                action: "account.session.created",
                metadata: {
                  method:
                    context?.path === "/sign-in/username"
                      ? "username"
                      : "email",
                },
              }).catch(() => undefined);
            },
          },
        },
        account: {
          create: {
            async after(account) {
              if (account.providerId === "credential") return;
              await AuditEvent.create({
                accountId: account.userId,
                action: "account.connector.linked",
                metadata: { providerId: account.providerId },
              }).catch(() => undefined);
            },
          },
          delete: {
            async after(account) {
              if (account.providerId === "credential") return;
              await AuditEvent.create({
                accountId: account.userId,
                action: "account.connector.unlinked",
                metadata: { providerId: account.providerId },
              }).catch(() => undefined);
            },
          },
        },
      },
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
          trustedClients: resolveFirstPartyClients({
            drive: process.env.DRIVE_ORIGIN,
            photos: process.env.PHOTOS_ORIGIN,
          }).map((client) => ({
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

import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { symmetricEncrypt } from "better-auth/crypto";
import {
  emailOTP,
  generateExportedKeyPair,
  jwt,
  username,
} from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { Resend } from "resend";
import { AuditEvent, connectDatabase, getDatabase } from "@xenode/database";
import {
  resolveFirstPartyClients,
  validateUsername,
} from "@xenode/identity-core";

const EMAIL_FROM = process.env.EMAIL_FROM ?? "Xenode <noreply@alerts.xenode.in>";
const PRIMARY_RS256_KEY_ID = "xenode-accounts-rs256-v1";

export function resolveSocialProviders(
  env: Partial<
    Record<
      | "GOOGLE_CLIENT_ID"
      | "GOOGLE_CLIENT_SECRET"
      | "GITHUB_CLIENT_ID"
      | "GITHUB_CLIENT_SECRET",
      string
    >
  >,
) {
  const googleClientId = env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const githubClientId = env.GITHUB_CLIENT_ID?.trim();
  const githubClientSecret = env.GITHUB_CLIENT_SECRET?.trim();
  return {
    ...(googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            scope: ["openid", "email", "profile"],
          },
        }
      : {}),
    ...(githubClientId && githubClientSecret
      ? {
          github: {
            clientId: githubClientId,
            clientSecret: githubClientSecret,
            scope: ["read:user", "user:email"],
          },
        }
      : {}),
  };
}

export function firstPartyIdTokenClaims(
  metadata?: Record<string, unknown>,
): { azp: string } {
  const authorizedParty = metadata?.authorizedParty;
  if (typeof authorizedParty !== "string") {
    throw new Error("OIDC client is missing its authorized party");
  }
  return { azp: authorizedParty };
}

async function ensureRs256SigningKey() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required");
  }
  const collection = getDatabase().collection("jwks");
  if (await collection.findOne({ id: PRIMARY_RS256_KEY_ID })) return;

  const keyPair = await generateExportedKeyPair({
    jwks: { keyPairConfig: { alg: "RS256", modulusLength: 2048 } },
  });
  const encryptedPrivateKey = await symmetricEncrypt({
    key: secret,
    data: JSON.stringify(keyPair.privateWebKey),
  });
  await collection.updateOne(
    { id: PRIMARY_RS256_KEY_ID },
    {
      $setOnInsert: {
        id: PRIMARY_RS256_KEY_ID,
        alg: "RS256",
        publicKey: JSON.stringify(keyPair.publicWebKey),
        privateKey: JSON.stringify(encryptedPrivateKey),
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
}

async function ensureFirstPartyOAuthClients() {
  const clients = resolveFirstPartyClients({
    drive: process.env.DRIVE_ORIGIN,
    photos: process.env.PHOTOS_ORIGIN,
  });
  const collection = getDatabase().collection("oauthClient");
  const now = new Date();
  await Promise.all(
    clients
      .filter((client) => client.clientId !== "xenode-mobile")
      .map((client) =>
        collection.updateOne(
          { clientId: client.clientId },
          {
            $set: {
              disabled: false,
              skipConsent: true,
              enableEndSession: true,
              scopes: ["openid", "profile", "email"],
              name: client.clientId,
              redirectUris: [...client.redirectUris],
              postLogoutRedirectUris: [
                ...(client.postLogoutRedirectUris ?? []),
              ],
              tokenEndpointAuthMethod: "none",
              grantTypes: ["authorization_code"],
              responseTypes: ["code"],
              public: true,
              type: "user-agent-based",
              requirePKCE: true,
              metadata: { authorizedParty: client.clientId },
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          { upsert: true },
        ),
      ),
  );
  return clients;
}

function otpEmailHtml(otp: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f7f9ff;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#06183a;padding:32px">
    <div style="max-width:440px;margin:0 auto;background:#ffffff;border:1px solid #d6e0f2;border-radius:18px;padding:32px">
      <p style="margin:0 0 4px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#003fba">Xenode Account</p>
      <h1 style="margin:0 0 12px;font-size:22px">Verify your email</h1>
      <p style="margin:0 0 20px;font-size:14px;color:#51617d">Enter this code to finish setting up your account. It expires in 10 minutes.</p>
      <div style="font-family:ui-monospace,Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:.35em;text-align:center;background:#edf2fb;border-radius:12px;padding:16px 0;color:#06183a">${otp}</div>
      <p style="margin:20px 0 0;font-size:12px;color:#51617d">If you didn't request this, you can safely ignore this email.</p>
    </div>
  </body></html>`;
}

async function createAccountsAuth() {
  await connectDatabase();
  await ensureRs256SigningKey();
  const accountsOrigin =
    process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in";
  const firstPartyClients = await ensureFirstPartyOAuthClients();
  const resend = new Resend(process.env.RESEND_API_KEY || "fallback");
  return betterAuth({
      appName: "Xenode Accounts",
      baseURL: accountsOrigin,
      secret: process.env.BETTER_AUTH_SECRET,
      disabledPaths: ["/token"],
      database: mongodbAdapter(
        getDatabase() as unknown as Parameters<typeof mongodbAdapter>[0],
        { usePlural: false, transaction: false },
      ),
      emailAndPassword: {
        enabled: true,
        minPasswordLength: 12,
        requireEmailVerification: true,
      },
      emailVerification: {
        sendOnSignUp: false,
        autoSignInAfterVerification: true,
      },
      socialProviders: resolveSocialProviders({
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
        GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
        GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
      }),
      account: {
        encryptOAuthTokens: true,
        accountLinking: {
          enabled: true,
          disableImplicitLinking: false,
          requireLocalEmailVerified: true,
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
                  method: context?.path?.includes("/callback/google")
                    ? "google"
                    : context?.path?.includes("/callback/github")
                      ? "github"
                      : context?.path === "/sign-in/username"
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
        emailOTP({
          otpLength: 6,
          expiresIn: 600,
          allowedAttempts: 5,
          overrideDefaultEmailVerification: true,
          sendVerificationOTP: async ({ email, otp, type }) => {
            if (type !== "email-verification") return;
            try {
              await resend.emails.send({
                from: EMAIL_FROM,
                to: email,
                subject: "Your Xenode verification code",
                html: otpEmailHtml(otp),
              });
            } catch (error) {
              console.error("[accounts] Failed to send OTP email:", error);
            }
          },
        }),
        jwt({
          disableSettingJwtHeader: true,
          jwks: {
            keyPairConfig: { alg: "RS256", modulusLength: 2048 },
          },
          adapter: {
            getJwks: async () => {
              const keys = await getDatabase()
                .collection("jwks")
                .find({ id: PRIMARY_RS256_KEY_ID })
                .toArray();
              return keys.map((key) => ({
                id: String(key._id),
                publicKey: String(key.publicKey),
                privateKey: String(key.privateKey),
                createdAt: new Date(key.createdAt),
                ...(key.expiresAt
                  ? { expiresAt: new Date(key.expiresAt) }
                  : {}),
                alg: "RS256" as const,
              }));
            },
          },
          jwt: {
            issuer: accountsOrigin,
            audience: accountsOrigin,
          },
        }),
        oauthProvider({
          loginPage: "/login",
          consentPage: "/oauth/authorize",
          allowDynamicClientRegistration: false,
          codeExpiresIn: 300,
          accessTokenExpiresIn: 3600,
          idTokenExpiresIn: 3600,
          grantTypes: ["authorization_code"],
          scopes: ["openid", "profile", "email"],
          customIdTokenClaims: ({ metadata }) =>
            firstPartyIdTokenClaims(metadata),
          silenceWarnings: {
            oauthAuthServerConfig: true,
            openidConfig: true,
          },
          cachedTrustedClients: new Set(
            firstPartyClients
              .filter((client) => client.clientId !== "xenode-mobile")
              .map((client) => client.clientId),
          ),
        }),
      ],
    });
}

let authPromise: ReturnType<typeof createAccountsAuth> | undefined;

export function getAccountsAuth() {
  authPromise ??= createAccountsAuth();
  return authPromise;
}

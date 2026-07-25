import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { emailOTP, jwt, oidcProvider, username } from "better-auth/plugins";
import { Resend } from "resend";
import { AuditEvent, connectDatabase, getDatabase } from "@xenode/database";
import {
  resolveFirstPartyClients,
  validateUsername,
} from "@xenode/identity-core";

const EMAIL_FROM = process.env.EMAIL_FROM ?? "Xenode <noreply@alerts.xenode.in>";

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
  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const resend = new Resend(process.env.RESEND_API_KEY || "fallback");
  return betterAuth({
      appName: "Xenode Accounts",
      baseURL: process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in",
      secret: process.env.BETTER_AUTH_SECRET,
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

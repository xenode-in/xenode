import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { parseSetCookieHeader } from "better-auth/cookies";
import {
  connectDatabase,
  createAuthSecurityRepository,
  getAccountOnboardingReadiness,
  getDatabase,
} from "@xenode/database";
import {
  CREDENTIAL_SIGN_IN_PATHS,
  completesSecondFactor,
  needsSecondFactor,
  sessionAuthMethod,
  type SessionAuthMethod,
} from "@/lib/second-factor-state";
import { applyTrustedSecondFactor } from "@/lib/trusted-second-factor";
import { hasVaultUnlockConfirmation } from "@/lib/vault-unlock-session";

const BETTER_AUTH_TRUST_DEVICE_COOKIE = "trust_device";

const SESSION_AUTH_METHODS = new Set<string>([
  "passkey",
  "totp",
  "trusted-device",
  "oauth",
  "email-otp",
  "password",
]);

/**
 * Session fields written when Better Auth creates any session. Deny by
 * default: unless a passkey or two-factor verification created the session,
 * an account with two-factor enabled starts pending its second factor.
 *
 * `currentSession` is the session that authenticated the creating request.
 * Better Auth rotates sessions inside authenticated endpoints (for example a
 * password change that revokes other sessions); the replacement for the same
 * account carries the verification its predecessor already had.
 */
export async function secondFactorSessionFields(args: {
  accountId: string;
  path: string;
  now?: Date;
  currentSession?: {
    userId?: unknown;
    authMethod?: unknown;
    twoFactorVerifiedAt?: unknown;
  } | null;
}): Promise<{
  authMethod: SessionAuthMethod;
  twoFactorVerifiedAt: Date | null;
}> {
  const now = args.now ?? new Date();
  const authMethod = sessionAuthMethod(args.path);
  if (completesSecondFactor(authMethod)) {
    return { authMethod, twoFactorVerifiedAt: now };
  }
  const current = args.currentSession;
  if (
    current &&
    String(current.userId) === args.accountId &&
    current.twoFactorVerifiedAt
  ) {
    return {
      authMethod: SESSION_AUTH_METHODS.has(String(current.authMethod))
        ? (current.authMethod as SessionAuthMethod)
        : authMethod,
      twoFactorVerifiedAt: now,
    };
  }
  await connectDatabase();
  const enabled = await createAuthSecurityRepository(
    getDatabase(),
  ).isTwoFactorEnabled(args.accountId);
  return { authMethod, twoFactorVerifiedAt: enabled ? null : now };
}

/**
 * Registered after Better Auth's two-factor plugin. A credential session for a
 * two-factor account survives that plugin only when it accepted and rotated
 * its signed trusted-device cookie; record that as the completed factor.
 */
export function secondFactorStatePlugin() {
  return {
    id: "xenode-second-factor-state",
    hooks: {
      after: [
        {
          matcher: (context: { path?: string }) =>
            CREDENTIAL_SIGN_IN_PATHS.has(context.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const created = ctx.context.newSession;
            const user = created?.user as
              | { id: string; twoFactorEnabled?: boolean | null }
              | undefined;
            if (!created || user?.twoFactorEnabled !== true) return;
            const trustCookie = ctx.context.createAuthCookie(
              BETTER_AUTH_TRUST_DEVICE_COOKIE,
            ).name;
            const rotated = parseSetCookieHeader(
              ctx.context.responseHeaders?.get("set-cookie") ?? "",
            ).get(trustCookie);
            if (!rotated?.value || !((rotated["max-age"] ?? 0) > 0)) return;
            const verifiedAt = new Date();
            await connectDatabase();
            const marked = await createAuthSecurityRepository(
              getDatabase(),
            ).markSecondFactorVerified({
              accountId: user.id,
              sessionId: created.session.id,
              verifiedAt,
              method: "trusted-device",
            });
            if (!marked) return;
            const session = created.session as {
              authMethod?: string | null;
              twoFactorVerifiedAt?: Date | null;
            };
            session.authMethod = "trusted-device";
            session.twoFactorVerifiedAt = verifiedAt;
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}

export type AuthorizationInteraction =
  | { kind: "second-factor"; path: "/two-factor" }
  | { kind: "onboarding"; path: "/onboarding" | "/auth/continue" }
  | { kind: "vault-unlock"; path: "/auth/continue" };

/**
 * The single gate for issuing an OIDC authorization code. The authorize GET
 * wrapper uses it to choose a step-up page; the OAuth provider's postLogin
 * hook uses it for in-process authorization after a sign-in or callback.
 */
export async function authorizationInteraction(args: {
  user: { id: string; twoFactorEnabled?: boolean | null };
  session: {
    id: string;
    authMethod?: string | null;
    twoFactorVerifiedAt?: Date | string | null;
  };
  headers: Headers;
}): Promise<AuthorizationInteraction | null> {
  const subject = { user: args.user, session: args.session };
  if (
    needsSecondFactor(subject) &&
    !(await applyTrustedSecondFactor(subject, args.headers))
  ) {
    return { kind: "second-factor", path: "/two-factor" };
  }
  const readiness = await getAccountOnboardingReadiness(args.user.id);
  if (!readiness.complete) {
    return {
      kind: "onboarding",
      path:
        readiness.profileOnboarded && readiness.hasVault
          ? "/auth/continue"
          : "/onboarding",
    };
  }
  const unlocked = await hasVaultUnlockConfirmation(args.headers, {
    accountId: args.user.id,
    sessionId: args.session.id,
  });
  return unlocked ? null : { kind: "vault-unlock", path: "/auth/continue" };
}

/** Page the OAuth provider redirects to; it resumes through the checked GET. */
export const OIDC_POST_LOGIN_PAGE = "/auth/post-login";

export const oidcPostLoginGate = {
  page: OIDC_POST_LOGIN_PAGE,
  consentReferenceId: () => undefined,
  shouldRedirect: async (context: {
    headers: Headers;
    user: { id: string } & Record<string, unknown>;
    session: { id: string } & Record<string, unknown>;
  }) =>
    (await authorizationInteraction({
      user: context.user as { id: string; twoFactorEnabled?: boolean | null },
      session: context.session as {
        id: string;
        twoFactorVerifiedAt?: Date | string | null;
      },
      headers: context.headers,
    })) !== null,
};

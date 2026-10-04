import type { RateLimitRule } from "@xenode/database";

/**
 * Credential and key-material changes require a session created this recently.
 * Protective actions (revoking sessions, devices or trusted browsers) do not,
 * so a stale or stolen session can always be cut off.
 */
export const RECENT_AUTH_MAX_AGE_MS = 10 * 60 * 1000;

const MINUTE = 60 * 1000;

/**
 * Per-account budgets for custom Accounts endpoints. Better Auth's limiter
 * covers only its own router, never these Next routes or in-process calls.
 * Protective revocation endpoints are deliberately unlimited: an attacker
 * holding a session must not be able to exhaust the owner's ability to revoke.
 */
export const ACCOUNTS_RATE_LIMITS = {
  /** Sign-in password create/verify/change: each request is a password check. */
  password: { bucket: "accounts:password", limit: 5, windowMs: 15 * MINUTE },
  /** Vault envelope, device and unlock-method writes. */
  vaultWrite: { bucket: "accounts:vault-write", limit: 10, windowMs: 10 * MINUTE },
  /** Local unlock confirmations and passkey unlock ceremonies. */
  vaultUnlock: { bucket: "accounts:vault-unlock", limit: 30, windowMs: 10 * MINUTE },
  /** Sign-in passkey binding and removal. */
  credentials: { bucket: "accounts:credentials", limit: 10, windowMs: 10 * MINUTE },
  /** Product key handoff creation. */
  keyHandoff: { bucket: "accounts:key-handoff", limit: 60, windowMs: 10 * MINUTE },
  /** Profile and onboarding updates. */
  profile: { bucket: "accounts:profile", limit: 30, windowMs: 10 * MINUTE },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Better Auth router limits (window in seconds, per client IP, enforced in
 * production). Its defaults already cover sign-in, sign-up, password change
 * and reset/OTP sends; two-factor endpoints otherwise use the 100-per-10s
 * global default. Server-to-server `/oauth2/token` stays on the default
 * because every exchange arrives from the product servers' addresses.
 */
export const NATIVE_AUTH_RATE_LIMIT_RULES = {
  "/two-factor/*": { window: 60, max: 10 },
};

export interface AccountsApiPolicy {
  recentAuth?: boolean;
  rateLimit?: RateLimitRule;
}

export function isRecentlyAuthenticated(
  session: { createdAt?: Date | string | null },
  now = Date.now(),
): boolean {
  const authenticatedAt = session.createdAt
    ? new Date(session.createdAt).getTime()
    : Number.NaN;
  return (
    Number.isFinite(authenticatedAt) &&
    authenticatedAt <= now &&
    now - authenticatedAt <= RECENT_AUTH_MAX_AGE_MS
  );
}

export function recentAuthRequired() {
  return Response.json(
    {
      error:
        "Sign in again to continue. This change requires a sign-in within the last 10 minutes.",
      code: "recent_auth_required",
    },
    { status: 403 },
  );
}

export function rateLimited(retryAfterSeconds: number) {
  return Response.json(
    { error: "Too many requests. Try again later.", code: "rate_limited" },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}

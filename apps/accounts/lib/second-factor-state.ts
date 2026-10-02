/**
 * Session second-factor state shared by the Better Auth hooks, page guards and
 * API guards. A session satisfies an enabled second factor only after a
 * passkey or two-factor verification created it, or a later step-up marked it.
 */
export type SessionAuthMethod =
  | "passkey"
  | "totp"
  | "trusted-device"
  | "oauth"
  | "email-otp"
  | "password";

/** One lockout budget for native sign-in challenges and session step-up. */
export const SECOND_FACTOR_LOCKOUT = {
  maxFailedAttempts: 10,
  lockDurationMs: 15 * 60 * 1000,
} as const;

/** Credential sign-ins that Better Auth's two-factor plugin intercepts. */
export const CREDENTIAL_SIGN_IN_PATHS = new Set([
  "/sign-in/email",
  "/sign-in/username",
  "/sign-in/phone-number",
]);

export function sessionAuthMethod(path: string): SessionAuthMethod {
  if (path.startsWith("/passkey/")) return "passkey";
  if (path.startsWith("/two-factor/")) return "totp";
  if (path.startsWith("/callback/")) return "oauth";
  if (path.startsWith("/email-otp/")) return "email-otp";
  return "password";
}

export function completesSecondFactor(method: SessionAuthMethod): boolean {
  return method === "passkey" || method === "totp";
}

export function needsSecondFactor(session: {
  user: { twoFactorEnabled?: boolean | null };
  session: { twoFactorVerifiedAt?: Date | string | null };
}): boolean {
  return (
    session.user.twoFactorEnabled === true &&
    !session.session.twoFactorVerifiedAt
  );
}

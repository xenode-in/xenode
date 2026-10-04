import { connectDatabase, consumeRateLimit } from "@xenode/database";
import { requireSameOrigin } from "@/lib/logout-coordinator";
import { getAccountsSession } from "@/lib/session";
import { needsSecondFactor } from "@/lib/second-factor-state";
import {
  isRecentlyAuthenticated,
  rateLimited,
  recentAuthRequired,
  type AccountsApiPolicy,
} from "@/lib/sensitive-actions";
import { applyTrustedSecondFactor } from "@/lib/trusted-second-factor";

function accountsOrigin() {
  return new URL(process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in")
    .origin;
}

function secondFactorRequired() {
  return Response.json({ error: "Second factor required" }, { status: 403 });
}

async function pendingSecondFactor(
  session: Awaited<ReturnType<typeof getAccountsSession>>,
  headers: Headers,
) {
  return (
    !!session &&
    needsSecondFactor(session) &&
    !(await applyTrustedSecondFactor(session, headers))
  );
}

/**
 * Enforce the same session step-up for direct Accounts API calls as for pages,
 * plus the route's sensitive-action policy: credential and key-material
 * changes require recent authentication, and custom endpoints spend a
 * per-account request budget.
 */
export async function authorizeAccountsApiRequest(
  request: Request,
  policy: AccountsApiPolicy = {},
): Promise<Response | null> {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    try {
      requireSameOrigin(request, accountsOrigin());
    } catch (response) {
      return response as Response;
    }
  }

  const session = await getAccountsSession(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (await pendingSecondFactor(session, request.headers)) {
    return secondFactorRequired();
  }
  if (policy.recentAuth && !isRecentlyAuthenticated(session.session)) {
    return recentAuthRequired();
  }
  if (policy.rateLimit) {
    await connectDatabase();
    const decision = await consumeRateLimit(policy.rateLimit, session.user.id);
    if (!decision.allowed) return rateLimited(decision.retryAfterSeconds);
  }
  return null;
}

function nativePath(request: Request) {
  return new URL(request.url).pathname.replace(/^\/api\/auth/u, "");
}

/** Native endpoints that add or remove a sign-in credential. */
const RECENT_AUTH_NATIVE_PATHS = new Set([
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/passkey/delete-passkey",
  "/link-social",
  "/unlink-account",
]);

/**
 * Native reads a pending session may still need while it completes its second
 * factor or leaves. Anything else (sessions, accounts, passkeys, clients) is
 * denied until step-up, because those responses describe or act on the
 * account as if the second factor were complete.
 */
function pendingSessionMayRead(path: string) {
  return (
    path === "/get-session" ||
    path === "/ok" ||
    path === "/error" ||
    path === "/jwks" ||
    path === "/verify-email" ||
    path === "/oauth2/end-session" ||
    path === "/oauth2/userinfo" ||
    path === "/passkey/generate-authenticate-options" ||
    path.startsWith("/callback/") ||
    path.startsWith("/reset-password/") ||
    path.startsWith("/.well-known/")
  );
}

/** Native writes that start or finish authentication, or leave. */
function pendingSessionMayWrite(path: string) {
  return (
    path.startsWith("/sign-in/") ||
    path.startsWith("/sign-up/") ||
    path === "/sign-out" ||
    path === "/oauth2/token" ||
    path === "/passkey/verify-authentication" ||
    path === "/email-otp/send-verification-otp" ||
    path === "/email-otp/verify-email" ||
    path === "/request-password-reset" ||
    path === "/forget-password" ||
    path === "/reset-password"
  );
}

export async function authorizeNativeAuthGet(
  request: Request,
): Promise<Response | null> {
  const path = nativePath(request);
  if (pendingSessionMayRead(path)) return null;
  const session = await getAccountsSession(request);
  if (!session) return null;
  if (await pendingSecondFactor(session, request.headers)) {
    return secondFactorRequired();
  }
  return RECENT_AUTH_NATIVE_PATHS.has(path) &&
    !isRecentlyAuthenticated(session.session)
    ? recentAuthRequired()
    : null;
}

/** Pending sessions may finish authentication or exit, but not mutate account state. */
export async function authorizeNativeAuthPost(
  request: Request,
): Promise<Response | null> {
  const path = nativePath(request);
  if (pendingSessionMayWrite(path)) return null;

  // Native /two-factor/verify-* stays available to sign-in challenges (no
  // session), where Better Auth counts attempts. With a session it skips that
  // budget, so a pending session must use /api/account/two-factor/verify.
  const session = await getAccountsSession(request);
  if (!session) return null;
  if (needsSecondFactor(session)) {
    try {
      requireSameOrigin(request, accountsOrigin());
    } catch (response) {
      return response as Response;
    }
    if (await pendingSecondFactor(session, request.headers)) {
      return secondFactorRequired();
    }
  }
  return RECENT_AUTH_NATIVE_PATHS.has(path) &&
    !isRecentlyAuthenticated(session.session)
    ? recentAuthRequired()
    : null;
}

import { requireSameOrigin } from "@/lib/logout-coordinator";
import { getAccountsSession } from "@/lib/session";
import { needsSecondFactor } from "@/lib/second-factor-state";
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

/** Enforce the same session step-up for direct Accounts API calls as for pages. */
export async function authorizeAccountsApiRequest(
  request: Request,
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
  return null;
}

function nativePath(request: Request) {
  return new URL(request.url).pathname.replace(/^\/api\/auth/u, "");
}

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
    path.startsWith("/callback/") ||
    path.startsWith("/reset-password/") ||
    path.startsWith("/.well-known/")
  );
}

export async function authorizeNativeAuthGet(
  request: Request,
): Promise<Response | null> {
  if (pendingSessionMayRead(nativePath(request))) return null;
  const session = await getAccountsSession(request);
  return (await pendingSecondFactor(session, request.headers))
    ? secondFactorRequired()
    : null;
}

/** Pending sessions may finish authentication or exit, but not mutate account state. */
export async function authorizeNativeAuthPost(
  request: Request,
): Promise<Response | null> {
  const path = nativePath(request);
  if (
    path.startsWith("/sign-in/") ||
    path.startsWith("/sign-up/") ||
    path === "/sign-out" ||
    path === "/oauth2/token" ||
    path === "/email-otp/send-verification-otp" ||
    path === "/email-otp/verify-email" ||
    path === "/request-password-reset" ||
    path === "/forget-password" ||
    path === "/reset-password"
  ) {
    return null;
  }

  // Native /two-factor/verify-* stays available to sign-in challenges (no
  // session), where Better Auth counts attempts. With a session it skips that
  // budget, so a pending session must use /api/account/two-factor/verify.
  const session = await getAccountsSession(request);
  if (!session || !needsSecondFactor(session)) return null;
  try {
    requireSameOrigin(request, accountsOrigin());
  } catch (response) {
    return response as Response;
  }
  return (await pendingSecondFactor(session, request.headers))
    ? secondFactorRequired()
    : null;
}

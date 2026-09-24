import { requireSameOrigin } from "@/lib/logout-coordinator";
import { getAccountsSession, needsSecondFactor } from "@/lib/session";
import { applyTrustedSecondFactor } from "@/lib/trusted-second-factor";

/** Enforce the same session step-up for direct Accounts API calls as for pages. */
export async function authorizeAccountsApiRequest(
  request: Request,
): Promise<Response | null> {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    try {
      requireSameOrigin(
        request,
        new URL(process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in")
          .origin,
      );
    } catch (response) {
      return response as Response;
    }
  }

  const session = await getAccountsSession(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (
    needsSecondFactor(session) &&
    !(await applyTrustedSecondFactor(session, request.headers))
  ) {
    return Response.json({ error: "Second factor required" }, { status: 403 });
  }
  return null;
}

/** Pending OAuth sessions may finish authentication or exit, but not mutate account state. */
export async function authorizeNativeAuthPost(
  request: Request,
): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth/u, "");
  if (
    path.startsWith("/sign-in/") ||
    path.startsWith("/sign-up/") ||
    path === "/sign-out" ||
    path === "/oauth2/token" ||
    path === "/two-factor/send-otp" ||
    path.startsWith("/two-factor/verify-") ||
    path === "/email-otp/send-verification-otp" ||
    path === "/email-otp/verify-email" ||
    path === "/request-password-reset" ||
    path === "/forget-password" ||
    path === "/reset-password"
  ) {
    return null;
  }

  const session = await getAccountsSession(request);
  if (session && needsSecondFactor(session)) {
    try {
      requireSameOrigin(
        request,
        new URL(process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in")
          .origin,
      );
    } catch (response) {
      return response as Response;
    }
    if (!(await applyTrustedSecondFactor(session, request.headers))) {
      return Response.json({ error: "Second factor required" }, { status: 403 });
    }
  }
  return null;
}

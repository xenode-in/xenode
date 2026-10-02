import { toNextJsHandler } from "better-auth/next-js";
import { getAccountsAuth } from "@/lib/auth";
import { authorizationInteraction } from "@/lib/second-factor-policy";
import {
  authorizeNativeAuthGet,
  authorizeNativeAuthPost,
} from "@/lib/api-session";
import { revokeIssuerProductsBeforeSessionDelete } from "@/lib/issuer-session-revocation";
import { requireSameOrigin } from "@/lib/logout-coordinator";
import { POST as changeSignInPassword } from "@/app/api/account/password/change/route";

function rejectsResourceIndicator(request: Request): boolean {
  const url = new URL(request.url);
  return (
    (url.pathname.endsWith("/oauth2/authorize") ||
      url.pathname.endsWith("/oauth2/token")) &&
    url.searchParams.has("resource")
  );
}

export async function GET(request: Request) {
  if (rejectsResourceIndicator(request)) {
    return Response.json(
      { error: "invalid_target", error_description: "resource is unsupported" },
      { status: 400 },
    );
  }
  const auth = await getAccountsAuth();
  const url = new URL(request.url);
  if (url.pathname.endsWith("/oauth2/authorize")) {
    const session = await auth.api.getSession({ headers: request.headers });
    const interaction = session
      ? await authorizationInteraction({
          user: session.user,
          session: session.session,
          headers: request.headers,
        })
      : null;
    if (interaction) {
      const redirectUrl = new URL(interaction.path, url.origin);
      redirectUrl.searchParams.set("next", `${url.pathname}${url.search}`);
      return Response.redirect(redirectUrl);
    }
  } else {
    const denied = await authorizeNativeAuthGet(request);
    if (denied) return denied;
  }
  return toNextJsHandler(auth).GET(request);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/change-password")) return changeSignInPassword(request);
  if (url.pathname.endsWith("/oauth2/token")) {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const body = new URLSearchParams(await request.clone().text());
      if (body.has("resource")) {
        return Response.json(
          {
            error: "invalid_target",
            error_description: "resource is unsupported",
          },
          { status: 400 },
        );
      }
    }
  }
  const denied = await authorizeNativeAuthPost(request);
  if (denied) return denied;
  if (url.pathname.endsWith("/sign-out")) {
    try {
      requireSameOrigin(
        request,
        new URL(process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in")
          .origin,
      );
    } catch (response) {
      return response as Response;
    }
    const auth = await getAccountsAuth();
    const session = await auth.api.getSession({
      headers: request.headers,
      query: { disableCookieCache: true },
    });
    if (session) {
      await revokeIssuerProductsBeforeSessionDelete(session.session);
    }
    return toNextJsHandler(auth).POST(request);
  }
  return toNextJsHandler(await getAccountsAuth()).POST(request);
}

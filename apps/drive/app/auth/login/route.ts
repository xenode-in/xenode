import { cookies } from "next/headers";
import {
  buildOidcAuthorizationUrl,
  createOidcFlow,
} from "@xenode/identity-core";

/**
 * GET /auth/login — begin the Accounts OIDC Authorization Code + PKCE flow
 * as the `xenode-drive-web` client. Mirrors apps/photos/app/auth/login.
 */
export async function GET(request: Request) {
  const issuer = process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in";
  const origin =
    process.env.DRIVE_ORIGIN ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://drive.xenode.in";
  const flow = await createOidcFlow(
    new URL(request.url).searchParams.get("next"),
    "/dashboard",
  );
  const jar = await cookies();
  const options = {
    httpOnly: true,
    secure: new URL(origin).protocol === "https:",
    sameSite: "lax" as const,
    path: "/auth/callback",
    maxAge: 300,
  };
  jar.set("xenode_drive_oidc_state", flow.state, options);
  jar.set("xenode_drive_oidc_nonce", flow.nonce, options);
  jar.set("xenode_drive_pkce", flow.verifier, options);
  jar.set("xenode_drive_oidc_return", flow.returnTo, options);

  return Response.redirect(
    buildOidcAuthorizationUrl({
      issuer,
      clientId: "xenode-drive-web",
      redirectUri: `${origin}/auth/callback`,
      flow,
    }),
  );
}

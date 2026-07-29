import { cookies } from "next/headers";
import {
  buildOidcAuthorizationUrl,
  createOidcFlow,
} from "@xenode/identity-core";

export async function GET(request: Request) {
  const issuer = process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in";
  const origin = process.env.PHOTOS_ORIGIN ?? "https://photos.xenode.in";
  const flow = await createOidcFlow(
    new URL(request.url).searchParams.get("next"),
    "/library",
  );
  const jar = await cookies();
  const options = {
    httpOnly: true,
    secure: new URL(origin).protocol === "https:",
    sameSite: "lax" as const,
    path: "/auth/callback",
    maxAge: 300,
  };
  jar.set("xenode_photos_oidc_state", flow.state, options);
  jar.set("xenode_photos_oidc_nonce", flow.nonce, options);
  jar.set("xenode_photos_pkce", flow.verifier, options);
  jar.set("xenode_photos_oidc_return", flow.returnTo, options);

  return Response.redirect(
    buildOidcAuthorizationUrl({
      issuer,
      clientId: "xenode-photos-web",
      redirectUri: `${origin}/auth/callback`,
      flow,
    }),
  );
}

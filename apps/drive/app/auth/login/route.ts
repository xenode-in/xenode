import { cookies } from "next/headers";

function base64Url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/**
 * GET /auth/login — begin the Accounts OIDC Authorization Code + PKCE flow
 * as the `xenode-drive-web` client. Mirrors apps/photos/app/auth/login.
 */
export async function GET() {
  const issuer = process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in";
  const origin =
    process.env.DRIVE_ORIGIN ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://xenode.in";
  const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const jar = await cookies();
  const options = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/auth/callback",
    maxAge: 300,
  };
  jar.set("xenode_drive_oidc_state", state, options);
  jar.set("xenode_drive_oidc_nonce", nonce, options);
  jar.set("xenode_drive_pkce", verifier, options);

  const authorize = new URL("/api/auth/oauth2/authorize", issuer);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", "xenode-drive-web");
  authorize.searchParams.set("redirect_uri", `${origin}/auth/callback`);
  authorize.searchParams.set("scope", "openid profile email");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  return Response.redirect(authorize);
}

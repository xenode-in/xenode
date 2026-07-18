import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ProductSession } from "@xenode/database";
import dbConnect from "@/lib/mongodb";

function failure(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * GET /auth/callback — complete the Accounts OIDC Authorization Code + PKCE
 * flow for the `xenode-drive-web` client: exchange the code, verify the
 * id_token against the Accounts JWKS (issuer + audience + nonce), then mint a
 * host-only Drive ProductSession cookie. Mirrors apps/photos/app/auth/callback.
 */
export async function GET(request: Request) {
  const issuer = process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in";
  const origin =
    process.env.DRIVE_ORIGIN ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://xenode.in";
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const jar = await cookies();
  const expectedState = jar.get("xenode_drive_oidc_state")?.value;
  const nonce = jar.get("xenode_drive_oidc_nonce")?.value;
  const verifier = jar.get("xenode_drive_pkce")?.value;
  if (!code || !returnedState || returnedState !== expectedState || !nonce || !verifier) {
    return failure("Invalid OIDC callback state");
  }

  const tokenResponse = await fetch(new URL("/api/auth/oauth2/token", issuer), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${origin}/auth/callback`,
      client_id: "xenode-drive-web",
      code_verifier: verifier,
    }),
    cache: "no-store",
  });
  if (!tokenResponse.ok) return failure("Authorization code exchange failed");
  const tokens = (await tokenResponse.json()) as {
    id_token?: string;
    expires_in?: number;
  };
  if (!tokens.id_token) return failure("OIDC provider did not issue an ID token");

  let payload;
  try {
    ({ payload } = await jwtVerify(
      tokens.id_token,
      createRemoteJWKSet(new URL("/api/auth/jwks", issuer)),
      { issuer, audience: "xenode-drive-web" },
    ));
  } catch {
    return failure("Invalid OIDC token");
  }
  if (payload.nonce !== nonce || typeof payload.sub !== "string") {
    return failure("Invalid OIDC token nonce");
  }

  await dbConnect();
  const sessionId = randomUUID();
  const expiresAt = new Date(
    Date.now() +
      Math.min(Number(tokens.expires_in) || 3600, 7 * 24 * 3600) * 1000,
  );
  await ProductSession.create({
    sessionId,
    accountId: payload.sub,
    productId: "drive",
    authenticatedAt: new Date(),
    sessionVersion: 1,
    expiresAt,
  });
  jar.set("xenode_drive_session", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  jar.delete("xenode_drive_oidc_state");
  jar.delete("xenode_drive_oidc_nonce");
  jar.delete("xenode_drive_pkce");
  return Response.redirect(new URL("/dashboard", origin));
}

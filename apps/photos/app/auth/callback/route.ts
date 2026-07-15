import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { connectDatabase, ProductSession } from "@xenode/database";

function failure(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  const issuer = process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in";
  const origin = process.env.PHOTOS_ORIGIN ?? "https://photos.xenode.in";
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const jar = await cookies();
  const expectedState = jar.get("xenode_photos_oidc_state")?.value;
  const nonce = jar.get("xenode_photos_oidc_nonce")?.value;
  const verifier = jar.get("xenode_photos_pkce")?.value;
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
      client_id: "xenode-photos-web",
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
      { issuer, audience: "xenode-photos-web" },
    ));
  } catch {
    return failure("Invalid OIDC token");
  }
  if (payload.nonce !== nonce || typeof payload.sub !== "string") {
    return failure("Invalid OIDC token nonce");
  }

  await connectDatabase();
  const sessionId = randomUUID();
  const expiresAt = new Date(
    Date.now() +
      Math.min(Number(tokens.expires_in) || 3600, 7 * 24 * 3600) * 1000,
  );
  await ProductSession.create({
    sessionId,
    accountId: payload.sub,
    productId: "photos",
    authenticatedAt: new Date(),
    sessionVersion: 1,
    expiresAt,
  });
  jar.set("xenode_photos_session", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  jar.delete("xenode_photos_oidc_state");
  jar.delete("xenode_photos_oidc_nonce");
  jar.delete("xenode_photos_pkce");
  return Response.redirect(new URL("/", origin));
}

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { connectDatabase, ProductSession } from "@xenode/database";
import { sanitizeReturnTo } from "@xenode/identity-core";
import { createPhotosSessionCookie } from "@/lib/product-cookie";

function failure(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  const issuer = process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in";
  const origin = process.env.PHOTOS_ORIGIN ?? "https://photos.xenode.in";
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const returnedIssuer = url.searchParams.get("iss");
  const jar = await cookies();
  const expectedState = jar.get("xenode_photos_oidc_state")?.value;
  const nonce = jar.get("xenode_photos_oidc_nonce")?.value;
  const verifier = jar.get("xenode_photos_pkce")?.value;
  const returnTo = sanitizeReturnTo(
    jar.get("xenode_photos_oidc_return")?.value,
    "/",
  );
  if (
    !code ||
    !returnedState ||
    returnedState !== expectedState ||
    (returnedIssuer !== null && returnedIssuer !== issuer) ||
    !nonce ||
    !verifier
  ) {
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
  if (payload.nonce !== nonce) {
    return failure("Invalid OIDC token nonce");
  }
  if (typeof payload.sub !== "string") {
    return failure("Invalid OIDC token subject");
  }
  if (typeof payload.sid !== "string") {
    return failure("Invalid OIDC issuer session");
  }
  if (payload.azp !== "xenode-photos-web") {
    return failure("Invalid OIDC authorized party");
  }
  if (typeof payload.exp !== "number") {
    return failure("Invalid OIDC token expiry");
  }

  await connectDatabase();
  const sessionId = randomUUID();
  const expiresAt = new Date(
    Math.min(payload.exp * 1000, Date.now() + 3600 * 1000),
  );
  await ProductSession.create({
    sessionId,
    accountId: payload.sub,
    productId: "photos",
    issuerSessionId: payload.sid,
    clientId: "xenode-photos-web",
    authenticatedAt: new Date(),
    sessionVersion: 1,
    expiresAt,
  });
  jar.set("xenode_photos_session", await createPhotosSessionCookie({
    sessionId,
    sessionVersion: 1,
    expiresAt,
  }), {
    httpOnly: true,
    secure: new URL(origin).protocol === "https:",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  jar.delete("xenode_photos_oidc_state");
  jar.delete("xenode_photos_oidc_nonce");
  jar.delete("xenode_photos_pkce");
  jar.delete("xenode_photos_oidc_return");
  return Response.redirect(new URL(returnTo, origin));
}

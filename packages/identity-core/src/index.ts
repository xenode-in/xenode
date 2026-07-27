const DEFAULT_RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "api",
  "auth",
  "billing",
  "help",
  "login",
  "oauth",
  "photos",
  "root",
  "security",
  "support",
  "system",
  "xenode",
]);

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function validateUsername(
  username: string,
  reserved = DEFAULT_RESERVED_USERNAMES,
): boolean {
  const normalized = normalizeUsername(username);
  return (
    /^[a-z0-9_]{3,30}$/u.test(normalized) && !reserved.has(normalized)
  );
}

export interface FirstPartyClient {
  clientId: string;
  productId: string;
  redirectUris: readonly string[];
  postLogoutRedirectUris?: readonly string[];
  publicClient: boolean;
}

export const FIRST_PARTY_CLIENTS: readonly FirstPartyClient[] = [
  {
    clientId: "xenode-drive-web",
    productId: "drive",
    redirectUris: ["https://drive.xenode.in/auth/callback"],
    postLogoutRedirectUris: ["https://drive.xenode.in/"],
    publicClient: true,
  },
  {
    clientId: "xenode-photos-web",
    productId: "photos",
    redirectUris: ["https://photos.xenode.in/auth/callback"],
    postLogoutRedirectUris: ["https://photos.xenode.in/"],
    publicClient: true,
  },
  {
    clientId: "xenode-mobile",
    productId: "mobile",
    redirectUris: ["in.xenode.app://auth/callback"],
    publicClient: true,
  },
];

/**
 * Resolve the first-party client registry with deployment-supplied origins.
 *
 * Each web product's redirect allowlist stays a static, explicit list — this
 * only appends `${origin}/auth/callback` for origins the DEPLOYMENT declares
 * via env (e.g. `DRIVE_ORIGIN=http://localhost:3000` for local dev, or a
 * staging origin). Origins are validated as absolute http(s) URLs and
 * normalized to their origin; anything else throws rather than silently
 * widening the allowlist. Products without a supplied origin (e.g. mobile's
 * custom scheme) are returned unchanged, and production URIs dedupe.
 */
export function resolveFirstPartyClients(
  origins: Partial<Record<string, string>> = {},
  clients = FIRST_PARTY_CLIENTS,
): FirstPartyClient[] {
  return clients.map((client) => {
    const supplied = origins[client.productId];
    if (!supplied) return client;
    let origin: string;
    try {
      const url = new URL(supplied);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("unsupported protocol");
      }
      origin = url.origin;
    } catch {
      throw new Error(
        `Invalid OIDC origin for product "${client.productId}": ${supplied}`,
      );
    }
    const redirect = `${origin}/auth/callback`;
    const postLogoutRedirect = `${origin}/`;
    return {
      ...client,
      redirectUris: client.redirectUris.includes(redirect)
        ? client.redirectUris
        : [...client.redirectUris, redirect],
      postLogoutRedirectUris: client.postLogoutRedirectUris?.includes(
        postLogoutRedirect,
      )
        ? client.postLogoutRedirectUris
        : [...(client.postLogoutRedirectUris ?? []), postLogoutRedirect],
    };
  });
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export async function pkceS256(verifier: string): Promise<string> {
  if (verifier.length < 43 || verifier.length > 128) {
    throw new Error("Invalid PKCE verifier length");
  }
  return base64Url(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verifier),
      ),
    ),
  );
}

function randomBase64Url(byteLength: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export interface OidcFlow {
  state: string;
  nonce: string;
  verifier: string;
  challenge: string;
  returnTo: string;
}

/** Create the single-use values required by an OIDC Authorization Code flow. */
export async function createOidcFlow(
  returnTo: string | null | undefined,
  fallback: string,
): Promise<OidcFlow> {
  const verifier = randomBase64Url(48);
  return {
    state: randomBase64Url(24),
    nonce: randomBase64Url(24),
    verifier,
    challenge: await pkceS256(verifier),
    returnTo: sanitizeReturnTo(returnTo, fallback),
  };
}

/** Only permit an absolute path on the current product origin. */
export function sanitizeReturnTo(
  value: string | null | undefined,
  fallback: string,
): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return fallback;
  }
  try {
    const parsed = new URL(value, "https://product.invalid");
    if (parsed.origin !== "https://product.invalid") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function buildOidcAuthorizationUrl(args: {
  issuer: string;
  clientId: string;
  redirectUri: string;
  flow: OidcFlow;
}): URL {
  const authorize = new URL("/api/auth/oauth2/authorize", args.issuer);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", args.clientId);
  authorize.searchParams.set("redirect_uri", args.redirectUri);
  authorize.searchParams.set("scope", "openid profile email");
  authorize.searchParams.set("state", args.flow.state);
  authorize.searchParams.set("nonce", args.flow.nonce);
  authorize.searchParams.set("code_challenge", args.flow.challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  return authorize;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(
    normalized + "=".repeat((4 - (normalized.length % 4)) % 4),
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sessionCookieMac(
  payload: string,
  secret: string,
): Promise<string> {
  if (utf8(secret).length < 32) {
    throw new Error("Product session cookie secret must be at least 32 bytes");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(utf8(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new Uint8Array(utf8(payload))),
    ),
  );
}

export interface ProductSessionCookiePayload {
  sessionId: string;
  sessionVersion: number;
  productId: string;
  expiresAt: number;
}

/** Sign the host-only cookie without placing identity or key material in it. */
export async function encodeProductSessionCookie(
  payload: ProductSessionCookiePayload,
  secret: string,
): Promise<string> {
  const body = base64Url(utf8(JSON.stringify(payload)));
  return `${body}.${await sessionCookieMac(body, secret)}`;
}

export async function decodeProductSessionCookie(
  value: string,
  secret: string,
): Promise<ProductSessionCookiePayload | null> {
  const [body, signature, extra] = value.split(".");
  if (!body || !signature || extra) return null;
  const expected = await sessionCookieMac(body, secret);
  const left = utf8(signature);
  const right = utf8(expected);
  if (left.length !== right.length) return null;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  if (difference !== 0) return null;
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(body)),
    ) as Partial<ProductSessionCookiePayload>;
    if (
      typeof parsed.sessionId !== "string" ||
      !parsed.sessionId ||
      !Number.isInteger(parsed.sessionVersion) ||
      Number(parsed.sessionVersion) < 1 ||
      typeof parsed.productId !== "string" ||
      !parsed.productId ||
      !Number.isInteger(parsed.expiresAt) ||
      Number(parsed.expiresAt) <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return parsed as ProductSessionCookiePayload;
  } catch {
    return null;
  }
}

export interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export function validateAuthorizationRequest(
  request: AuthorizationRequest,
  clients = FIRST_PARTY_CLIENTS,
): FirstPartyClient {
  const client = clients.find((candidate) => candidate.clientId === request.clientId);
  if (
    !client ||
    !client.redirectUris.includes(request.redirectUri) ||
    request.state.length < 16 ||
    request.nonce.length < 16 ||
    request.codeChallenge.length < 43 ||
    request.codeChallengeMethod !== "S256"
  ) {
    throw new Error("Invalid OIDC authorization request");
  }
  return client;
}

export interface IdTokenClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  iat: number;
  nonce: string;
}

export function validateIdTokenClaims(
  claims: IdTokenClaims,
  expected: {
    issuer: string;
    audience: string;
    nonce: string;
    nowSeconds?: number;
  },
): void {
  const now = expected.nowSeconds ?? Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.iss !== expected.issuer ||
    !audiences.includes(expected.audience) ||
    claims.nonce !== expected.nonce ||
    claims.exp <= now ||
    claims.iat > now + 60 ||
    !claims.sub
  ) {
    throw new Error("Invalid OIDC token claims");
  }
}

export interface AuthorizationCodeRecord {
  code: string;
  clientId: string;
  redirectUri: string;
  accountId: string;
  nonce: string;
  codeChallenge: string;
  expiresAt: Date;
}

export interface AuthorizationCodeStore {
  consume(code: string): Promise<AuthorizationCodeRecord | null>;
}

export async function redeemAuthorizationCode(
  args: {
    code: string;
    clientId: string;
    redirectUri: string;
    verifier: string;
    now?: Date;
  },
  store: AuthorizationCodeStore,
): Promise<AuthorizationCodeRecord> {
  const record = await store.consume(args.code);
  if (
    !record ||
    record.clientId !== args.clientId ||
    record.redirectUri !== args.redirectUri ||
    record.expiresAt.getTime() <= (args.now ?? new Date()).getTime() ||
    record.codeChallenge !== (await pkceS256(args.verifier))
  ) {
    throw new Error("Invalid or consumed authorization code");
  }
  return record;
}

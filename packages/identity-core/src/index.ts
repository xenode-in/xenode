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
  publicClient: boolean;
}

export const FIRST_PARTY_CLIENTS: readonly FirstPartyClient[] = [
  {
    clientId: "xenode-drive-web",
    productId: "drive",
    redirectUris: ["https://xenode.in/auth/callback"],
    publicClient: true,
  },
  {
    clientId: "xenode-photos-web",
    productId: "photos",
    redirectUris: ["https://photos.xenode.in/auth/callback"],
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
    if (client.redirectUris.includes(redirect)) return client;
    return { ...client, redirectUris: [...client.redirectUris, redirect] };
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

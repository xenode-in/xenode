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

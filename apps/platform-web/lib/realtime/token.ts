import { createHmac } from "node:crypto";

const TOKEN_TTL_SECONDS = 5 * 60;

function secret(): string {
  const value =
    process.env.REALTIME_TOKEN_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!value) {
    throw new Error(
      "REALTIME_TOKEN_SECRET or BETTER_AUTH_SECRET must be configured",
    );
  }
  return value;
}

export function createRealtimeToken(userId: string): {
  token: string;
  expiresAt: string;
} {
  const expiresAtMs = Date.now() + TOKEN_TTL_SECONDS * 1000;
  const body = Buffer.from(
    JSON.stringify({
      sub: userId,
      exp: Math.floor(expiresAtMs / 1000),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret())
    .update(body)
    .digest("base64url");
  return {
    token: `${body}.${signature}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

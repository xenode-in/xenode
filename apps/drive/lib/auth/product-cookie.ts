import {
  decodeProductSessionCookie,
  encodeProductSessionCookie,
} from "@xenode/identity-core";

const LOCAL_SECRET = "xenode-drive-local-session-cookie-secret";

function secret(): string {
  const configured =
    process.env.DRIVE_SESSION_COOKIE_SECRET ??
    process.env.PRODUCT_SESSION_COOKIE_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("DRIVE_SESSION_COOKIE_SECRET is required in production");
  }
  return LOCAL_SECRET;
}

export async function createDriveSessionCookie(args: {
  sessionId: string;
  sessionVersion: number;
  expiresAt: Date;
}): Promise<string> {
  return encodeProductSessionCookie(
    {
      ...args,
      productId: "drive",
      expiresAt: Math.floor(args.expiresAt.getTime() / 1000),
    },
    secret(),
  );
}

export async function parseDriveSessionCookie(
  value: string,
): Promise<{ sessionId: string; sessionVersion: number } | null> {
  const payload = await decodeProductSessionCookie(value, secret());
  if (!payload || payload.productId !== "drive") return null;
  return {
    sessionId: payload.sessionId,
    sessionVersion: payload.sessionVersion,
  };
}

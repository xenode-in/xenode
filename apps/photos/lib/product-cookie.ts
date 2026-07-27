import {
  decodeProductSessionCookie,
  encodeProductSessionCookie,
} from "@xenode/identity-core";

const LOCAL_SECRET = "xenode-photos-local-session-cookie-secret";

function secret(): string {
  const configured =
    process.env.PHOTOS_SESSION_COOKIE_SECRET ??
    process.env.PRODUCT_SESSION_COOKIE_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("PHOTOS_SESSION_COOKIE_SECRET is required in production");
  }
  return LOCAL_SECRET;
}

export async function createPhotosSessionCookie(args: {
  sessionId: string;
  sessionVersion: number;
  expiresAt: Date;
}): Promise<string> {
  return encodeProductSessionCookie(
    {
      ...args,
      productId: "photos",
      expiresAt: Math.floor(args.expiresAt.getTime() / 1000),
    },
    secret(),
  );
}

export async function parsePhotosSessionCookie(
  value: string,
): Promise<{ sessionId: string; sessionVersion: number } | null> {
  const payload = await decodeProductSessionCookie(value, secret());
  if (!payload || payload.productId !== "photos") return null;
  return {
    sessionId: payload.sessionId,
    sessionVersion: payload.sessionVersion,
  };
}

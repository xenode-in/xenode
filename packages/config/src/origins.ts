export type WebProductId = "accounts" | "drive" | "photos";

const developmentOrigins: Record<WebProductId, string> = {
  accounts: "http://localhost:3001",
  drive: "http://localhost:3000",
  photos: "http://localhost:3002",
};

/** An origin is a trust boundary, never a URL with credentials or a path. */
export function validateWebOrigin(value: string, setting: string): string {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      (value !== url.origin && value !== `${url.origin}/`)
    ) {
      throw new Error("not an exact origin");
    }
    return url.origin;
  } catch {
    throw new Error(`${setting} must be an exact http(s) origin`);
  }
}

export function resolveProductOrigin(
  product: WebProductId,
  value: string | undefined,
  environment = process.env.NODE_ENV,
  setting = `${product.toUpperCase()}_ORIGIN`,
): string {
  if (value !== undefined) return validateWebOrigin(value, setting);
  if (environment === "production") {
    throw new Error(`${setting} is required in production`);
  }
  return developmentOrigins[product];
}

export function getServerProductOrigin(product: WebProductId): string {
  const setting = `${product.toUpperCase()}_ORIGIN`;
  return resolveProductOrigin(product, process.env[setting]);
}

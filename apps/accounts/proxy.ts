import { NextRequest, NextResponse } from "next/server";
import { resolveFirstPartyClients } from "@xenode/identity-core";

function trustedEmbeddingOrigin(request: NextRequest): string | null {
  const params = request.nextUrl.searchParams;
  if (params.get("mode") !== "iframe") return null;

  const clientId = params.get("clientId");
  const productId = params.get("productId");
  const requestedOrigin = params.get("destinationOrigin");
  if (!clientId || !productId || !requestedOrigin) return null;

  let destinationOrigin: string;
  try {
    destinationOrigin = new URL(requestedOrigin).origin;
  } catch {
    return null;
  }
  if (destinationOrigin !== requestedOrigin) return null;

  const client = resolveFirstPartyClients({
    drive: process.env.DRIVE_ORIGIN,
    photos: process.env.PHOTOS_ORIGIN,
  }).find((candidate) => candidate.clientId === clientId);
  if (!client || client.productId !== productId) return null;

  const allowed = client.redirectUris.some((redirectUri) => {
    try {
      const url = new URL(redirectUri);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.origin === destinationOrigin
      );
    } catch {
      return false;
    }
  });
  return allowed ? destinationOrigin : null;
}

export function proxy(request: NextRequest) {
  const embeddingOrigin = trustedEmbeddingOrigin(request);
  const response = NextResponse.next();
  const scriptPolicy =
    process.env.NODE_ENV === "production"
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      scriptPolicy,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      `frame-ancestors ${embeddingOrigin ?? "'none'"}`,
      "base-uri 'none'",
      "object-src 'none'",
      "form-action 'self'",
    ].join("; "),
  );
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  response.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  response.headers.set("Cross-Origin-Opener-Policy", "unsafe-none");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export const config = {
  matcher: ["/security/key-handoff"],
};

import { randomUUID } from "node:crypto";
import type { ProductSlug } from "@xenode/contracts";
import {
  REALTIME_TICKET_MAX_TTL_SECONDS,
  isRealtimeProduct,
  issueRealtimeTicket,
} from "@xenode/realtime";

function ticketSecret(): string {
  const value = process.env.REALTIME_TICKET_SECRET;
  if (!value || Buffer.byteLength(value) < 32) {
    throw new Error("REALTIME_TICKET_SECRET must be configured with at least 32 bytes");
  }
  if (
    value === process.env.BETTER_AUTH_SECRET ||
    value === process.env.CDN_SIGNING_SECRET
  ) {
    throw new Error("REALTIME_TICKET_SECRET must be independent");
  }
  return value;
}

/**
 * Issue a 60-second, one-use realtime ticket. `origin` is the exact page
 * origin of a browser request (null only for bearer-authenticated native
 * clients); `sessionExpiresAt` bounds how long the socket may stay connected.
 */
export async function createRealtimeToken(args: {
  accountId: string;
  productId: ProductSlug;
  spaceId: string;
  sessionId: string;
  sessionExpiresAt: Date;
  origin: string | null;
}): Promise<{ token: string; expiresAt: string }> {
  if (!isRealtimeProduct(args.productId)) {
    throw new Error("Realtime is not available for this product");
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + REALTIME_TICKET_MAX_TTL_SECONDS;
  const token = await issueRealtimeTicket(
    {
      ticketId: randomUUID(),
      accountId: args.accountId,
      productId: args.productId,
      spaceId: args.spaceId,
      sessionId: args.sessionId,
      origin: args.origin,
      issuedAt,
      expiresAt,
      sessionExpiresAt: Math.floor(args.sessionExpiresAt.getTime() / 1000),
    },
    ticketSecret(),
  );
  return { token, expiresAt: new Date(expiresAt * 1000).toISOString() };
}

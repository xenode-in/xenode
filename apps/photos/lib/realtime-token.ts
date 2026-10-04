import { randomUUID } from "node:crypto";
import {
  REALTIME_TICKET_MAX_TTL_SECONDS,
  issueRealtimeTicket,
} from "@xenode/realtime";

/** Issue a one-use realtime ticket bound to the page origin and session expiry. */
export async function createPhotosRealtimeToken(args: {
  accountId: string;
  spaceId: string;
  sessionId: string;
  sessionExpiresAt: Date;
  origin: string;
}) {
  const secret = process.env.REALTIME_TICKET_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("REALTIME_TICKET_SECRET must be at least 32 bytes");
  }
  if (
    secret === process.env.BETTER_AUTH_SECRET ||
    secret === process.env.CDN_SIGNING_SECRET
  ) {
    throw new Error("REALTIME_TICKET_SECRET must be independent");
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + REALTIME_TICKET_MAX_TTL_SECONDS;
  return {
    token: await issueRealtimeTicket(
      {
        ticketId: randomUUID(),
        accountId: args.accountId,
        productId: "photos",
        spaceId: args.spaceId,
        sessionId: args.sessionId,
        origin: args.origin,
        issuedAt,
        expiresAt,
        sessionExpiresAt: Math.floor(args.sessionExpiresAt.getTime() / 1000),
      },
      secret,
    ),
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

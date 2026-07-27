import { randomUUID } from "node:crypto";
import { issueRealtimeTicket } from "@xenode/realtime";

export async function createPhotosRealtimeToken(args: {
  accountId: string;
  spaceId: string;
  sessionId: string;
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
  const expiresAt = issuedAt + 60;
  return {
    token: await issueRealtimeTicket(
      {
        ticketId: randomUUID(),
        accountId: args.accountId,
        productId: "photos",
        spaceId: args.spaceId,
        sessionId: args.sessionId,
        issuedAt,
        expiresAt,
      },
      secret,
    ),
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

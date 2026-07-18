import { randomUUID } from "node:crypto";
import type { ProductSlug } from "@xenode/contracts";
import { issueRealtimeTicket } from "@xenode/realtime";

const TICKET_TTL_SECONDS = 60;

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

export async function createRealtimeToken(args: {
  accountId: string;
  productId: ProductSlug;
  spaceId: string;
  sessionId: string;
}): Promise<{ token: string; expiresAt: string }> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + TICKET_TTL_SECONDS;
  const token = await issueRealtimeTicket(
    {
      ticketId: randomUUID(),
      accountId: args.accountId,
      productId: args.productId,
      spaceId: args.spaceId,
      sessionId: args.sessionId,
      issuedAt,
      expiresAt,
    },
    ticketSecret(),
  );
  return { token, expiresAt: new Date(expiresAt * 1000).toISOString() };
}

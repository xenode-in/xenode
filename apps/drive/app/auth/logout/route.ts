import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ProductSession } from "@xenode/database";
import {
  createProductSessionRevokedEvent,
  REALTIME_CHANNEL,
  REALTIME_TICKET_MAX_TTL_SECONDS,
  realtimeRevokedSessionKey,
} from "@xenode/realtime";
import { DRIVE_SESSION_COOKIE, getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import { withRedis } from "@/lib/redis";

/**
 * POST /auth/logout — revoke the caller's Drive ProductSession and clear the
 * host-only session cookie. Revocation is propagated to realtime (best
 * effort) so live sockets drop; the DB flag alone already blocks all
 * subsequent requests. Kept for compatibility; user-facing sign-out uses
 * /auth/logout/start so the matching Accounts and Photos sessions also end.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(request);

  if (session) {
    await dbConnect();
    const revoked = await ProductSession.findOneAndUpdate(
      {
        sessionId: session.session.id,
        productId: "drive",
        revokedAt: { $exists: false },
      },
      { $set: { revokedAt: new Date() }, $inc: { sessionVersion: 1 } },
      { new: true },
    ).lean();

    if (revoked) {
      const event = createProductSessionRevokedEvent({
        eventId: randomUUID(),
        accountId: revoked.accountId,
        productId: "drive",
        sessionId: revoked.sessionId,
        sessionExpiresAt: revoked.expiresAt,
      });
      await withRedis(async (redis) => {
        await redis
          .multi()
          .set(
            realtimeRevokedSessionKey(revoked.sessionId),
            "1",
            "EX",
            REALTIME_TICKET_MAX_TTL_SECONDS,
          )
          .publish(REALTIME_CHANNEL, JSON.stringify(event))
          .exec();
      });
    }
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: DRIVE_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

import { NextRequest, NextResponse } from "next/server";
import { exactRealtimeOrigin } from "@xenode/realtime";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { createRealtimeToken } from "@/lib/realtime/token";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const access = await requireAccessContext(request);
    // Browser tickets bind the requesting page's exact Origin, which the
    // socket handshake must repeat. Only bearer-authenticated native clients
    // receive an origin-less ticket; a cookie request without Origin is refused.
    const bearer = request.headers
      .get("authorization")
      ?.startsWith("Bearer ");
    const origin = bearer
      ? null
      : exactRealtimeOrigin(request.headers.get("origin"));
    if (!bearer && !origin) {
      return NextResponse.json(
        { error: "Realtime tickets require an exact Origin" },
        { status: 403 },
      );
    }
    const sessionExpiresAt = new Date(access.session.session.expiresAt);
    const response = NextResponse.json(
      await createRealtimeToken({
        accountId: access.accountId,
        productId: access.productId,
        spaceId: access.spaceId,
        sessionId: access.session.session.id,
        sessionExpiresAt,
        origin,
      }),
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    console.error("[realtime] Ticket creation failed", error);
    return NextResponse.json(
      { error: "Realtime ticket creation failed" },
      { status: 500 },
    );
  }
}

import { readFeatureFlag } from "@xenode/config";
import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { createRealtimeToken } from "@/lib/realtime/token";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!readFeatureFlag("REALTIME_TICKETS_V2_ENABLED", process.env)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const access = await requireAccessContext(request);
    const response = NextResponse.json(
      await createRealtimeToken({
        accountId: access.accountId,
        productId: access.productId,
        spaceId: access.spaceId,
        sessionId: access.session.session.id,
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

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requireAccessContext } from "@/lib/authz";
import { createRealtimeToken } from "@/lib/realtime/token";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const [session, access] = await Promise.all([
      requireAuth(request),
      requireAccessContext(request),
    ]);
    return NextResponse.json(
      await createRealtimeToken({
        accountId: session.user.id,
        productId: "drive",
        spaceId: access.spaceId,
        sessionId: session.session.id,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Token creation failed",
      },
      { status: 500 },
    );
  }
}

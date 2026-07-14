import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { createRealtimeToken } from "@/lib/realtime/token";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    return NextResponse.json(createRealtimeToken(session.user.id));
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

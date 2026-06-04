import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { requireAuth } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const ctx = await getAuth().$context;
    const sessions = (
      await ctx.internalAdapter.listSessions(session.user.id, {
        onlyActiveSessions: true,
      })
    ).filter((item) => item.expiresAt > new Date());

    return NextResponse.json({
      currentToken: session.session.token,
      sessions,
    });
  } catch (error) {
    console.error("Failed to list sessions:", error);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const { token, allOthers } = (await request.json().catch(() => ({}))) as {
      token?: string;
      allOthers?: boolean;
    };
    const ctx = await getAuth().$context;

    if (allOthers) {
      const sessions = (
        await ctx.internalAdapter.listSessions(session.user.id, {
          onlyActiveSessions: true,
        })
      ).filter((item) => item.expiresAt > new Date());

      await Promise.all(
        sessions
          .filter((item) => item.token !== session.session.token)
          .map((item) => ctx.internalAdapter.deleteSession(item.token)),
      );

      return NextResponse.json({ status: true });
    }

    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const target = await ctx.internalAdapter.findSession(token);
    if (target?.session.userId === session.user.id) {
      await ctx.internalAdapter.deleteSession(token);
    }

    return NextResponse.json({ status: true });
  } catch (error) {
    console.error("Failed to revoke session:", error);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

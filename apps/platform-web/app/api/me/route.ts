import { NextRequest, NextResponse } from "next/server";
import { getServerSession, requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import { User } from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * GET /api/me — the client-side session probe backing the useSession() hook.
 * Returns the same `{ user, session }` payload as getServerSession, or null.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(request);
  return NextResponse.json(session);
}

/**
 * PATCH /api/me — the few profile fields Drive still writes itself
 * (onboarding name, encrypt-by-default). Everything else — password, email,
 * 2FA, avatar, devices — is managed at the Accounts hub.
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      encryptByDefault?: unknown;
      onboarded?: unknown;
      image?: unknown;
    };

    const update: Record<string, unknown> = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name || name.length > 120) {
        return NextResponse.json({ error: "Invalid name" }, { status: 400 });
      }
      update.name = name;
    }
    if (typeof body.encryptByDefault === "boolean") {
      update.encryptByDefault = body.encryptByDefault;
    }
    if (body.onboarded === true) {
      update.onboarded = true;
    }
    if (typeof body.image === "string") {
      const image = body.image.trim();
      if (image.length > 2048 || (image && !/^(https?:\/\/|\/)/u.test(image))) {
        return NextResponse.json({ error: "Invalid image URL" }, { status: 400 });
      }
      update.image = image;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "No supported fields to update" },
        { status: 400 },
      );
    }

    await dbConnect();
    await User.updateOne({ _id: session.user.id }, { $set: update });
    return NextResponse.json(await getServerSession(request));
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}

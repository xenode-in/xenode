import { getServerProductOrigin } from "@xenode/config";
import { NextRequest, NextResponse } from "next/server";
import {
  ProductSession,
  createBrowserLogoutTransaction,
} from "@xenode/database";
import { DRIVE_SESSION_COOKIE, getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";

export async function POST(request: NextRequest) {
  const driveOrigin =
    getServerProductOrigin("drive");
  if (request.headers.get("origin") !== new URL(driveOrigin).origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const session = await getServerSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await dbConnect();
  await ProductSession.updateOne(
    {
      sessionId: session.session.id,
      productId: "drive",
      revokedAt: { $exists: false },
    },
    { $set: { revokedAt: new Date() }, $inc: { sessionVersion: 1 } },
  );

  const accountsOrigin =
    getServerProductOrigin("accounts");
  const transaction = await createBrowserLogoutTransaction({
    accountId: session.user.id,
    issuerSessionId: session.session.issuerSessionId,
    initiatingProduct: "drive",
  });
  const target = new URL("/logout", accountsOrigin);
  target.searchParams.set("transaction", transaction.token);
  const logoutUrl = target.toString();
  const response = NextResponse.json({ logoutUrl });
  response.cookies.set({
    name: DRIVE_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: new URL(driveOrigin).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

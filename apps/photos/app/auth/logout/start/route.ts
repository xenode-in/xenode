import { NextResponse } from "next/server";
import {
  ProductSession,
  createBrowserLogoutTransaction,
} from "@xenode/database";
import { getPhotosProductSession } from "@/lib/session";

export async function POST(request: Request) {
  const photosOrigin =
    process.env.PHOTOS_ORIGIN ??
    (process.env.NODE_ENV === "production"
      ? "https://photos.xenode.in"
      : "http://localhost:3002");
  if (request.headers.get("origin") !== new URL(photosOrigin).origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const session = await getPhotosProductSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ProductSession.updateOne(
    { sessionId: session.sessionId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() }, $inc: { sessionVersion: 1 } },
  );
  const accountsOrigin =
    process.env.ACCOUNTS_ORIGIN ??
    process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN ??
    (process.env.NODE_ENV === "production"
      ? "https://accounts.xenode.in"
      : "http://localhost:3001");
  const transaction = await createBrowserLogoutTransaction({
    accountId: session.accountId,
    issuerSessionId: session.issuerSessionId,
    initiatingProduct: "photos",
  });
  const target = new URL("/logout", accountsOrigin);
  target.searchParams.set("transaction", transaction.token);
  const logoutUrl = target.toString();
  const response = NextResponse.json({ logoutUrl });
  response.cookies.set({
    name: "xenode_photos_session",
    value: "",
    httpOnly: true,
    secure: new URL(photosOrigin).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

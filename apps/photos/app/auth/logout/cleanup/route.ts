import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  ProductSession,
  consumeBrowserLogoutCleanupTicket,
} from "@xenode/database";
import { parsePhotosSessionCookie } from "@/lib/product-cookie";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticket = url.searchParams.get("ticket");
  const transaction = ticket
    ? await consumeBrowserLogoutCleanupTicket(ticket, "photos")
    : null;
  if (!transaction) return new Response("Expired", { status: 410 });
  const rawCookie = /(?:^|;\s*)xenode_photos_session=([^;]+)/u.exec(
    request.headers.get("cookie") ?? "",
  )?.[1];
  const credential = rawCookie
    ? await parsePhotosSessionCookie(decodeURIComponent(rawCookie))
    : null;
  const session = credential
    ? await ProductSession.findOne({ sessionId: credential.sessionId }).lean()
    : null;
  const shouldClear =
    !session ||
    (session.accountId === transaction.accountId &&
      session.issuerSessionId === transaction.issuerSessionId);
  const accountsOrigin =
    process.env.ACCOUNTS_ORIGIN ??
    (process.env.NODE_ENV === "production"
      ? "https://accounts.xenode.in"
      : "http://localhost:3001");
  const nonce = randomBytes(18).toString("base64url");
  const script = shouldClear
    ? `
      try { new BroadcastChannel("xenode-auth:photos").postMessage({type:"logout"}); } catch {}
      for (const name of ["xenode-keys-photos","xenode-handoff-photos"]) {
        try { indexedDB.deleteDatabase(name); } catch {}
      }
    `
    : "";
  const response = new NextResponse(
    `<!doctype html><meta charset="utf-8"><script nonce="${nonce}">${script}
      parent.postMessage({type:"xenode:logout-cleanup",productId:"photos"},${JSON.stringify(new URL(accountsOrigin).origin)});
    </script>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors ${new URL(accountsOrigin).origin}`,
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    },
  );
  if (shouldClear) {
    response.cookies.set({
      name: "xenode_photos_session",
      value: "",
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}
